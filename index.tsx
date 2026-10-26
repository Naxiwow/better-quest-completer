import "./style.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByCodeLazy, findComponentByCodeLazy } from "@webpack";
import { ApplicationStreamingStore, ChannelStore, FluxDispatcher, GuildChannelStore, QuestStore, RestAPI, RunningGameStore } from "@webpack/common";

const QuestIcon = findComponentByCodeLazy("10.47a.76.76");
// Discord's own "refresh the quest list" action.
const fetchCurrentQuests = findByCodeLazy("QUESTS_FETCH_CURRENT_QUESTS_BEGIN") as () => Promise<void>;

/** QuestTargetedContent.QUEST_HOME_DESKTOP: where Discord says the quest was accepted from. */
const QUEST_HOME_DESKTOP = 11;

const settings = definePluginSettings({
    enableNotifications: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show notifications (start, problems, summary)",
    },
    autoStart: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Run on startup (and keep looking for new quests, see below)",
    },
    repeatEveryMinutes: {
        type: OptionType.SLIDER,
        description: "With 'run on startup': look for new quests again every N minutes (0 = never)",
        markers: [0, 15, 30, 60, 120],
        default: 30,
        stickToMarkers: true,
    },
    autoEnroll: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Accept every available quest automatically (not only the ones you already accepted)",
    },
    parallel: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Do several quests at the same time (much faster). Off = one after the other",
    },
    delayBetweenQuests: {
        type: OptionType.SLIDER,
        description: "wait between quests when 'parallel' is off (seconds)",
        markers: [0, 5, 10, 30, 60],
        default: 5,
        stickToMarkers: true,
    },
    allowWatchVideo: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "WATCH_VIDEO",
    },
    allowPlayDesktop: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "PLAY_ON_DESKTOP",
    },
    allowStream: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "STREAM_ON_DESKTOP (needs you to really stream in a voice channel with someone)",
    },
    allowActivity: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "PLAY_ACTIVITY",
    },
    allowWatchMobile: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "WATCH_VIDEO_ON_MOBILE",
    },
    speedMultiplier: {
        type: OptionType.SLIDER,
        description: "speed (1 = real time, 7 = fast)",
        markers: [1, 2, 3, 4, 5, 6, 7],
        default: 7,
        stickToMarkers: true,
    },
});

type Kind = "video" | "activity" | "play" | "stream";

/** Which quest tasks we can do, in the order we prefer them (quests only need ONE task: joinOperator "or"). */
const TASKS: Array<{ name: string; kind: Kind; enabled: () => boolean; needsApp: boolean; }> = [
    { name: "WATCH_VIDEO", kind: "video", enabled: () => !!settings.store.allowWatchVideo, needsApp: false },
    { name: "WATCH_VIDEO_ON_MOBILE", kind: "video", enabled: () => !!settings.store.allowWatchMobile, needsApp: false },
    { name: "PLAY_ACTIVITY", kind: "activity", enabled: () => !!settings.store.allowActivity, needsApp: false },
    { name: "PLAY_ON_DESKTOP", kind: "play", enabled: () => !!settings.store.allowPlayDesktop, needsApp: true },
    { name: "STREAM_ON_DESKTOP", kind: "stream", enabled: () => !!settings.store.allowStream, needsApp: true },
];

interface Job {
    questId: string;
    name: string;
    taskName: string;
    kind: Kind;
    secondsNeeded: number;
    app: { id?: string; name: string; };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function notify(title: string, body: string) {
    if (!settings.store.enableNotifications) return;
    showNotification({ title, body, dismissOnClick: false });
}

let running = false;
let cancelled = false;
let repeatTimer: ReturnType<typeof setInterval> | null = null;
let startTimer: ReturnType<typeof setTimeout> | null = null;

const log = (...a: any[]) => console.log("[BetterQuestCompleter]", ...a);

/** Readable text for a failed Discord request (the raw error object prints as "[object Object]"). */
function errText(e: any): string {
    if (e?.status) return `HTTP ${e.status}${e.body?.message ? ` ${e.body.message}` : ""}`;
    return String(e?.message ?? e);
}

// Discord rate limits the quest endpoints. With several quests running at once, requests are queued
// (one every 400 ms) and a 429 is retried after the delay Discord asks for, instead of failing the quest.
let nextSlot = 0;
let gap = 400;
async function qpost(args: { url: string; body: any; }) {
    for (let attempt = 0; ; attempt++) {
        const now = Date.now();
        const at = Math.max(now, nextSlot);
        nextSlot = at + gap;
        if (at > now) await sleep(at - now);
        try {
            const res = await RestAPI.post(args);
            gap = Math.max(400, gap * 0.95);
            return res;
        } catch (e: any) {
            if (e?.status !== 429 || attempt >= 20) throw e;
            // Discord's reported delay is often too short when several quests run: slow everything down and back off.
            gap = Math.min(4000, gap * 1.5);
            const wait = Math.max(1, Number(e?.body?.retry_after) || 1) * 1000 * Math.min(1 + attempt * 0.3, 5) + Math.random() * 500;
            nextSlot = Math.max(nextSlot, Date.now() + wait);
            await sleep(wait);
        }
    }
}

function snakeToCamel(obj: any): any {
    if (Array.isArray(obj)) return obj.map(snakeToCamel);
    if (obj && typeof obj === "object") {
        return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), snakeToCamel(v)]));
    }
    return obj;
}

function getTaskConfig(quest: any) {
    return quest.config.taskConfig ?? quest.config.taskConfigV2;
}

function getQuest(id: string): any {
    return (QuestStore as any).getQuest?.(id) ?? QuestStore.quests.get(id);
}

// Discord moved the application from config.application onto the task itself.
function getApplication(quest: any, task: any): { id?: string; name: string; } {
    const app = task?.applications?.[0] ?? quest.config.application;
    return {
        id: app?.id ?? quest.config.applicationId,
        name: app?.name ?? quest.config.messages?.gameTitle ?? "l'application",
    };
}

function getProgress(userStatus: any, taskName: string): number {
    return Math.floor(userStatus?.progress?.[taskName]?.value ?? userStatus?.streamProgressSeconds ?? 0);
}

const questName = (quest: any) => quest.config.messages?.questName ?? quest.id;

/* -------------------------------------------------------------------------- */
/*                                  Planning                                  */
/* -------------------------------------------------------------------------- */

function pickTask(quest: any, isApp: boolean) {
    const tasks = getTaskConfig(quest)?.tasks ?? {};
    return TASKS.find(t => tasks[t.name] != null && t.enabled() && (!t.needsApp || isApp));
}

function buildJob(quest: any, isApp: boolean): Job | null {
    const picked = pickTask(quest, isApp);
    if (!picked) return null;
    const task = getTaskConfig(quest).tasks[picked.name];
    return {
        questId: quest.id,
        name: questName(quest),
        taskName: picked.name,
        kind: picked.kind,
        secondsNeeded: task.target,
        app: getApplication(quest, task),
    };
}

function isOpen(quest: any) {
    const now = Date.now();
    const starts = quest.config.startsAt ? new Date(quest.config.startsAt).getTime() : 0;
    return new Date(quest.config.expiresAt).getTime() > now && starts <= now;
}

/* -------------------------------------------------------------------------- */
/*                                 Enrollment                                 */
/* -------------------------------------------------------------------------- */

function enrollmentBlockedForMs(): number {
    const raw = (QuestStore as any).questEnrollmentBlockedUntil;
    if (raw == null) return 0;
    const until = typeof raw === "number" ? raw : new Date(raw).getTime();
    return Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0;
}

type EnrollResult = "ok" | "rate_limited" | "captcha" | "failed";

async function enroll(questId: string): Promise<EnrollResult> {
    FluxDispatcher.dispatch({ type: "QUESTS_ENROLL_BEGIN", questId } as any);
    try {
        const res = await RestAPI.post({ url: `/quests/${questId}/enroll`, body: { location: QUEST_HOME_DESKTOP } });
        FluxDispatcher.dispatch({ type: "QUESTS_ENROLL_SUCCESS", enrolledQuestUserStatus: snakeToCamel(res.body) } as any);
        await new Promise<void>(resolve => FluxDispatcher.wait(resolve));
        return getQuest(questId)?.userStatus?.enrolledAt ? "ok" : "failed";
    } catch (e: any) {
        FluxDispatcher.dispatch({ type: "QUESTS_ENROLL_FAILURE", questId } as any);
        if (e?.body?.captcha_key || e?.body?.captcha_sitekey) return "captcha";
        if (e?.status === 429 || e?.body?.retry_after != null) {
            const wait = Number(e?.body?.retry_after);
            if (Number.isFinite(wait) && wait > 0 && wait <= 90) {
                await sleep(wait * 1000 + 500);
            }
            return "rate_limited";
        }
        log("enroll failed", questId, e);
        return "failed";
    }
}

/** Accepts every quest that still needs it. Returns ids that are NOT enrolled afterwards. */
async function enrollAll(jobs: Job[]): Promise<{ failed: string[]; stoppedBecause?: string; }> {
    const todo = jobs.filter(j => !getQuest(j.questId)?.userStatus?.enrolledAt);
    const failed: string[] = [];
    if (todo.length === 0) return { failed };

    const blocked = enrollmentBlockedForMs();
    if (blocked > 0) {
        return { failed: todo.map(j => j.questId), stoppedBecause: `Discord bloque les inscriptions pendant encore ${Math.ceil(blocked / 60000)} minute(s).` };
    }

    notify("Inscription aux quêtes", `${todo.length} quête(s) à accepter...`);
    let rateLimits = 0;
    for (const [i, job] of todo.entries()) {
        if (cancelled) { failed.push(...todo.slice(i).map(j => j.questId)); break; }
        let res = await enroll(job.questId);
        if (res === "rate_limited" && rateLimits < 2) {
            rateLimits++;
            res = await enroll(job.questId);
        }
        if (res === "captcha") {
            return { failed: todo.slice(i).map(j => j.questId), stoppedBecause: "Discord demande un captcha pour accepter les quêtes : accepte-en une à la main, puis relance." };
        }
        if (res === "rate_limited") {
            return { failed: todo.slice(i).map(j => j.questId), stoppedBecause: "Discord limite les inscriptions (trop de requêtes). Réessaie dans quelques minutes." };
        }
        if (res === "failed") failed.push(job.questId);
        await sleep(1200);
    }
    return { failed };
}

/* -------------------------------------------------------------------------- */
/*                                Task runners                                */
/* -------------------------------------------------------------------------- */

// Resolves once Discord's own heartbeats report this quest as done. Discord advances simulated games
// in turns (about two at a time), so a fixed timeout cuts long batches short: instead we only give up
// after `stallMs` WITHOUT any progress on this quest.
function waitForCompletion(questId: string, taskName: string, secondsNeeded: number, stallMs = 15 * 60_000) {
    return new Promise<void>((resolve, reject) => {
        let last = getProgress(getQuest(questId)?.userStatus, taskName);
        let timeout: ReturnType<typeof setTimeout>;
        const cleanup = () => {
            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
            clearTimeout(timeout);
            clearInterval(cancelWatch);
        };
        const armStall = () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => { cleanup(); reject(new Error("Discord n'a plus compté de progression (délai dépassé)")); }, stallMs);
        };
        const fn = (data: any) => {
            if (data?.questId && data.questId !== questId) return;
            const progress = getProgress(data?.userStatus, taskName);
            log(`${questId}: ${progress}/${secondsNeeded}`);
            if (progress >= secondsNeeded || data?.userStatus?.completedAt) {
                cleanup();
                resolve();
                return;
            }
            if (progress > last) {
                last = progress;
                armStall();
            }
        };
        const cancelWatch = setInterval(() => { if (cancelled) { cleanup(); reject(new Error("arrêté")); } }, 2000);

        if (getQuest(questId)?.userStatus?.completedAt) { clearInterval(cancelWatch); resolve(); return; }
        armStall();
        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
    });
}

async function doVideo(job: Job) {
    const quest = getQuest(job.questId);
    const speed = settings.store.speedMultiplier ?? 7;
    const maxFuture = 10;
    const enrolledAt = new Date(quest.userStatus.enrolledAt).getTime();
    let secondsDone = quest.userStatus?.progress?.[job.taskName]?.value ?? 0;
    let completed = false;

    while (!cancelled) {
        const maxAllowed = Math.floor((Date.now() - enrolledAt) / 1000) + maxFuture;
        const timestamp = secondsDone + speed;
        if (maxAllowed - secondsDone >= speed) {
            const res = await qpost({ url: `/quests/${job.questId}/video-progress`, body: { timestamp: Math.min(job.secondsNeeded, timestamp + Math.random()) } });
            completed = res.body?.completed_at != null;
            secondsDone = Math.min(job.secondsNeeded, timestamp);
        }
        if (timestamp >= job.secondsNeeded) break;
        await sleep(1000);
    }
    if (cancelled) throw new Error("arrêté");

    if (!completed) {
        await qpost({ url: `/quests/${job.questId}/video-progress`, body: { timestamp: job.secondsNeeded } });
    }
}

async function doActivity(job: Job) {
    const channelId = ChannelStore.getSortedPrivateChannels()?.[0]?.id
        ?? (Object.values(GuildChannelStore.getAllGuilds() ?? {}) as any[]).find(x => x?.VOCAL?.length > 0)?.VOCAL?.[0]?.channel?.id;
    if (!channelId) throw new Error("aucun salon trouvé pour la quête d'activité");

    const streamKey = `call:${channelId}:1`;
    while (!cancelled) {
        const res = await qpost({ url: `/quests/${job.questId}/heartbeat`, body: { stream_key: streamKey, terminal: false } });
        const progress = res.body?.progress?.PLAY_ACTIVITY?.value ?? 0;
        log(`${job.questId}: ${progress}/${job.secondsNeeded}`);
        if (progress >= job.secondsNeeded) {
            await qpost({ url: `/quests/${job.questId}/heartbeat`, body: { stream_key: streamKey, terminal: true } });
            return;
        }
        await sleep(20_000);
    }
    throw new Error("arrêté");
}

/** Fakes several running games at once: Discord then counts playtime for each of them. */
async function doPlayBatch(jobs: Job[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    const withApp = jobs.filter(j => {
        if (!j.app.id) { results.set(j.questId, "ID d'application introuvable"); return false; }
        return true;
    });
    if (withApp.length === 0) return results;

    // The parameter must be repeated once per application: a comma list is rejected ("not snowflake").
    const res = await RestAPI.get({ url: `/applications/public?${withApp.map(j => `application_ids=${j.app.id}`).join("&")}` });
    const byId = new Map<string, any>((res.body ?? []).map((a: any) => [a.id, a]));

    const fakes: Array<{ job: Job; game: any; }> = [];
    for (const job of withApp) {
        const appData = byId.get(job.app.id!);
        if (!appData) { results.set(job.questId, `application ${job.app.id} introuvable`); continue; }
        const exeName = appData.executables?.find((x: any) => x.os === "win32")?.name?.replace(">", "")
            ?? appData.name.replace(/[/\\:*?"<>|]/g, "");
        const pid = Math.floor(Math.random() * 30000) + 1000 + fakes.length;
        fakes.push({
            job,
            game: {
                cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
                exeName,
                exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
                hidden: false,
                isLauncher: false,
                id: job.app.id,
                name: appData.name,
                pid,
                pidPath: [pid],
                processName: appData.name,
                start: Date.now(),
            },
        });
    }
    if (fakes.length === 0) return results;

    const store = RunningGameStore as any;
    const realGetRunningGames = store.getRunningGames;
    const realGetGameForPID = store.getGameForPID;
    const realGames = store.getRunningGames();
    const games = fakes.map(f => f.game);

    store.getRunningGames = () => games;
    store.getGameForPID = (p: number) => games.find(g => g.pid === p);
    FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: games, games } as any);

    const longest = Math.max(...fakes.map(f => f.job.secondsNeeded - (getProgress(getQuest(f.job.questId)?.userStatus, f.job.taskName))));
    notify(`${fakes.length} jeu(x) simulé(s) en même temps`, `${fakes.map(f => f.game.name).join(", ")} — environ ${Math.ceil(Math.max(longest, 0) / 60)} minute(s).`);

    try {
        await Promise.all(fakes.map(async ({ job }) => {
            try {
                await waitForCompletion(job.questId, job.taskName, job.secondsNeeded);
                results.set(job.questId, null);
            } catch (e: any) {
                results.set(job.questId, String(e?.message ?? e));
            }
        }));
    } finally {
        store.getRunningGames = realGetRunningGames;
        store.getGameForPID = realGetGameForPID;
        FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: games, added: realGames, games: realGames } as any);
    }
    return results;
}

async function doStream(job: Job) {
    if (!job.app.id) throw new Error("ID d'application introuvable (format de quête inconnu)");
    const store = ApplicationStreamingStore as any;
    const realFunc = store.getStreamerActiveStreamMetadata;
    const pid = Math.floor(Math.random() * 30000) + 1000;
    store.getStreamerActiveStreamMetadata = () => ({ id: job.app.id, pid, sourceName: null });

    const remaining = Math.max(0, job.secondsNeeded - getProgress(getQuest(job.questId)?.userStatus, job.taskName));
    notify(
        `Stream simulé : ${job.app.name}. Streame n'importe quelle fenêtre en vocal pendant ${Math.ceil(remaining / 60)} minute(s).`,
        "Il faut au moins 1 autre personne dans le salon vocal !"
    );

    try {
        await waitForCompletion(job.questId, job.taskName, job.secondsNeeded, 20 * 60_000);
    } finally {
        store.getStreamerActiveStreamMetadata = realFunc;
    }
}

/** Runs `worker` over `items` with at most `limit` at a time. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
    const queue = [...items];
    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (queue.length && !cancelled) await worker(queue.shift()!);
    }));
}

/* -------------------------------------------------------------------------- */
/*                                    Main                                    */
/* -------------------------------------------------------------------------- */

async function refreshQuests() {
    try {
        await fetchCurrentQuests();
    } catch (e) {
        log("could not refresh the quest list", e);
    }
}

async function runQuestLogic(manual: boolean) {
    if (running) {
        if (manual) notify("Déjà en cours", "Clique encore sur le bouton pour arrêter.");
        return;
    }
    if (!QuestStore?.quests) {
        if (manual) notify("Quêtes non chargées", "Ouvre l'onglet Quêtes de Discord une fois, puis réessaie.");
        return;
    }

    running = true;
    cancelled = false;
    const isApp = typeof (window as any).DiscordNative !== "undefined";
    const done = new Set<string>();
    const failed = new Map<string, string>();
    const attempts = new Map<string, number>();
    let stopReason: string | undefined;

    try {
        for (let round = 1; round <= 4 && !cancelled; round++) {
            // Temporary problems (rate limits, Discord not counting progress...) get another go, up to 3 tries per quest.
            for (const [id, why] of [...failed]) {
                if (/HTTP 429|HTTP 5\d\d|plus compté|délai/i.test(why) && (attempts.get(id) ?? 0) < 3) failed.delete(id);
            }
            await refreshQuests();

            const open = ([...QuestStore.quests.values()] as any[]).filter(q => isOpen(q) && !q.userStatus?.completedAt && !failed.has(q.id));
            const jobs: Job[] = [];
            const noWay: string[] = [];
            for (const q of open) {
                if (!settings.store.autoEnroll && !q.userStatus?.enrolledAt) continue;
                const job = buildJob(q, isApp);
                if (job) jobs.push(job);
                else noWay.push(questName(q));
            }
            if (round === 1) {
                log("quêtes non faisables:", noWay);
                const count = (k: Kind) => jobs.filter(j => j.kind === k).length;
                if (jobs.length === 0) {
                    notify("Aucune quête à faire !", noWay.length ? `${noWay.length} quête(s) que je ne sais pas faire ici.` : "Tout est déjà fait.");
                } else {
                    notify(`${jobs.length} quête(s) à faire`, `vidéos ${count("video")}, jeux ${count("play")}, activités ${count("activity")}, streams ${count("stream")}`);
                }
            }
            if (jobs.length === 0) break;

            // 1) accept everything that needs it
            const enrollment = await enrollAll(jobs);
            enrollment.failed.forEach(id => failed.set(id, "inscription impossible"));
            if (enrollment.stoppedBecause) { stopReason = enrollment.stoppedBecause; notify("Inscription interrompue", stopReason); }

            // 2) do them (fresh quest objects: the store was updated by the enrollment)
            const ready = jobs.filter(j => getQuest(j.questId)?.userStatus?.enrolledAt && !failed.has(j.questId));
            ready.forEach(j => attempts.set(j.questId, (attempts.get(j.questId) ?? 0) + 1));
            const parallel = !!settings.store.parallel;
            const run = async (job: Job, fn: () => Promise<void>) => {
                try {
                    await fn();
                    done.add(job.questId);
                    log("terminée:", job.name);
                } catch (e: any) {
                    const why = errText(e);
                    // The server refuses the desktop video event for quests that only exist on mobile.
                    failed.set(job.questId, /does not support this event/i.test(why) ? "pas faisable depuis un ordinateur (quête mobile)" : why);
                    console.error("[BetterQuestCompleter]", job.name, why);
                }
            };

            const videos = ready.filter(j => j.kind === "video");
            const activities = ready.filter(j => j.kind === "activity");
            const plays = ready.filter(j => j.kind === "play");
            const streams = ready.filter(j => j.kind === "stream");

            const lanes: Array<Promise<void>> = [];
            lanes.push(pool(videos, parallel ? 5 : 1, async j => {
                await run(j, () => doVideo(j));
                if (!parallel) await sleep((settings.store.delayBetweenQuests ?? 5) * 1000);
            }));
            lanes.push(pool(activities, parallel ? 3 : 1, j => run(j, () => doActivity(j))));
            lanes.push((async () => {
                const groups = parallel ? [plays] : plays.map(p => [p]);
                for (const group of groups) {
                    if (cancelled || group.length === 0) return;
                    try {
                        const results = await doPlayBatch(group);
                        for (const j of group) {
                            const err = results.get(j.questId);
                            if (err == null) { done.add(j.questId); log("terminée:", j.name); } else failed.set(j.questId, err);
                        }
                    } catch (e: any) {
                        group.forEach(j => failed.set(j.questId, errText(e)));
                        console.error("[BetterQuestCompleter]", "jeux", errText(e));
                    }
                }
            })());
            await Promise.all(lanes);

            // streams need you to actually stream: one at a time, last
            for (const j of streams) {
                if (cancelled) break;
                await run(j, () => doStream(j));
            }

            if (ready.length === 0) break;
        }

        // Claiming needs a captcha, so rewards have to be collected by hand.
        const toClaim = ([...QuestStore.quests.values()] as any[]).filter(q => q.userStatus?.completedAt && !q.userStatus?.claimedAt && isOpen(q));
        const parts = [`${done.size} terminée(s)`];
        if (failed.size) parts.push(`${failed.size} en échec`);
        if (toClaim.length) parts.push(`${toClaim.length} récompense(s) à récupérer à la main (captcha)`);
        if (cancelled) parts.unshift("arrêté");
        notify("Better Quest Completer", parts.join(" · ") + (stopReason ? ` — ${stopReason}` : ""));
        if (failed.size) log("échecs:", [...failed].map(([id, why]) => `${getQuest(id) ? questName(getQuest(id)) : id}: ${why}`).join(" | "));
    } finally {
        running = false;
        cancelled = false;
    }
}

function start(manual = true) {
    runQuestLogic(manual).catch(e => {
        running = false;
        console.error("[BetterQuestCompleter]", e);
    });
}

function onButtonClick() {
    if (running) {
        cancelled = true;
        notify("Arrêt demandé", "Les quêtes en cours s'arrêtent.");
        return;
    }
    start(true);
}

function QuestButton() {
    return (
        <HeaderBarButton
            tooltip="Better Quest Completer (re-clique pour arrêter)"
            position="bottom"
            className="better-qc-button"
            icon={QuestIcon}
            onClick={onButtonClick}
        />
    );
}

export default definePlugin({
    name: "Better Quest Completer",
    description: "Accepts and auto-completes ALL Discord quests (several at once) — by Naxiwow (github.com/Naxiwow)",
    authors: [
        {
            name: "Naxiwow",
            id: 875342291001278504n,
        },
    ],
    settings,

    start() {
        if (!settings.store.autoStart) return;
        // Quests are fetched a bit after startup; give the store time to fill.
        startTimer = setTimeout(() => start(false), 15_000);
        const every = Number(settings.store.repeatEveryMinutes) || 0;
        if (every > 0) repeatTimer = setInterval(() => start(false), every * 60_000);
    },

    stop() {
        cancelled = true;
        if (startTimer) clearTimeout(startTimer);
        if (repeatTimer) clearInterval(repeatTimer);
        startTimer = repeatTimer = null;
    },

    headerBarButton: {
        icon: QuestIcon,
        render: QuestButton,
    },
});
