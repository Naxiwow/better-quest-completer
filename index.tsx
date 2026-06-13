import "./style.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Devs } from "@utils/constants";
import { findComponentByCodeLazy } from "@webpack";

const QuestIcon = findComponentByCodeLazy("10.47a.76.76");

function runQuestLogic() {
    

delete window.$;
let wpRequire = webpackChunkdiscord_app.push([[Symbol()], {}, r => r]);
webpackChunkdiscord_app.pop();

let ApplicationStreamingStore = Object.values(wpRequire.c).find(x => x?.exports?.A?.__proto__?.getStreamerActiveStreamMetadata).exports.A;
let RunningGameStore = Object.values(wpRequire.c).find(x => x?.exports?.Ay?.getRunningGames).exports.Ay;
let QuestsStore = Object.values(wpRequire.c).find(x => x?.exports?.A?.__proto__?.getQuest).exports.A;
let ChannelStore = Object.values(wpRequire.c).find(x => x?.exports?.A?.__proto__?.getAllThreadsForParent).exports.A;
let GuildChannelStore = Object.values(wpRequire.c).find(x => x?.exports?.Ay?.getSFWDefaultChannel).exports.Ay;
let FluxDispatcher = Object.values(wpRequire.c).find(x => x?.exports?.h?.__proto__?.flushWaitQueue).exports.h;
let api = Object.values(wpRequire.c).find(x => x?.exports?.Bo?.get).exports.Bo;

let taskTypes = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"]
let taskEnabled = [settings.store.allowWatchVideo, settings.store.allowPlayDesktop, settings.store.allowStream, settings.store.allowActivity, settings.store.allowWatchMobile]
let supportedTasks = taskTypes.filter((_, i) => taskEnabled[i])
let allQuests = [...QuestsStore.quests.values()].filter(x => x.userStatus?.enrolledAt && new Date(x.config.expiresAt).getTime() > Date.now())


let completedUnclaimed = allQuests.filter(x => x.userStatus?.completedAt && !x.userStatus?.claimedAt)
let quests = allQuests.filter(x => !x.userStatus?.completedAt && supportedTasks.find(y => Object.keys((x.config.taskConfig ?? x.config.taskConfigV2).tasks).includes(y)))
let isApp = typeof DiscordNative !== "undefined"

// notify about completed but unclaimed quests (claim requires captcha — do manually)
if(completedUnclaimed.length > 0) {
	completedUnclaimed.forEach(q => {
		let questName = q.config.messages?.questName ?? q.id
		showNotification({
			title: `Claim your orb: ${questName}`,
			body: `Quest already done — open Discord quests tab and click Claim.`,
			dismissOnClick: false,
		})
	})
}

if(quests.length === 0) {
	showNotification({
                    title: completedUnclaimed.length > 0 ? `Tried claiming ${completedUnclaimed.length} completed quest(s)!` : `You don't have any uncompleted quests!`,
                    body: completedUnclaimed.length > 0 ? `Check console for results.` : `Please make sure you have a quest selected.`,
					dismissOnClick: false,
                })
} else {
	let doJob = function() {
		const quest = quests.pop()
		if(!quest) return

		const pid = Math.floor(Math.random() * 30000) + 1000
		
		const applicationId = quest.config.application.id
		const applicationName = quest.config.application.name
		const questName = quest.config.messages.questName
		const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2
		const taskName = supportedTasks.find(x => taskConfig.tasks[x] != null)
		const secondsNeeded = taskConfig.tasks[taskName].target
		let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0

		if(taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
			const speed = settings.store.speedMultiplier ?? 7
			const maxFuture = 10, interval = 1
			const enrolledAt = new Date(quest.userStatus.enrolledAt).getTime()
			let completed = false
			let fn = async () => {			
				while(true) {
					const maxAllowed = Math.floor((Date.now() - enrolledAt)/1000) + maxFuture
					const diff = maxAllowed - secondsDone
					const timestamp = secondsDone + speed
					if(diff >= speed) {
						const res = await api.post({url: `/quests/${quest.id}/video-progress`, body: {timestamp: Math.min(secondsNeeded, timestamp + Math.random())}})
						completed = res.body.completed_at != null
						secondsDone = Math.min(secondsNeeded, timestamp)
					}
					
					if(timestamp >= secondsNeeded) {
						break
					}
					await new Promise(resolve => setTimeout(resolve, interval * 1000))
				}
				if(!completed) {
					await api.post({url: `/quests/${quest.id}/video-progress`, body: {timestamp: secondsNeeded}})
				}
				showNotification({
                    title: `Quest completed!`,
                    body: `${questName} - quest was successfully completed.`,
					dismissOnClick: false,
                })				doJob()
			}
			fn()
			showNotification({
                    title: `Spoofing video for: ${questName}.`,
                    body: `❤️ Better Quest Completer`,
					dismissOnClick: false,
                })
		} else if(taskName === "PLAY_ON_DESKTOP") {
			if(!isApp) {
				showNotification({
                    title: `Use the desktop app to complete the: ${applicationName} quest!`,
                    body: `This no longer works in browser for non-video quests.`,
					dismissOnClick: false,
			})
			} else {
				api.get({url: `/applications/public?application_ids=${applicationId}`}).then(res => {
					const appData = res.body[0]
					const exeName = appData.executables?.find(x => x.os === "win32")?.name?.replace(">","") ?? appData.name.replace(/[\/\\:*?"<>|]/g, "")
					
					const fakeGame = {
						cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
						exeName,
						exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
						hidden: false,
						isLauncher: false,
						id: applicationId,
						name: appData.name,
						pid: pid,
						pidPath: [pid],
						processName: appData.name,
						start: Date.now(),
					}
					const realGames = RunningGameStore.getRunningGames()
					const fakeGames = [fakeGame]
					const realGetRunningGames = RunningGameStore.getRunningGames
					const realGetGameForPID = RunningGameStore.getGameForPID
					RunningGameStore.getRunningGames = () => fakeGames
					RunningGameStore.getGameForPID = (pid) => fakeGames.find(x => x.pid === pid)
					FluxDispatcher.dispatch({type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames})
					
					let fn = async data => {
						let progress = quest.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress.PLAY_ON_DESKTOP.value)
						console.log(`Quest progress: ${progress}/${secondsNeeded}`)
					    console.log(`Quest progress: ${progress}/${secondsNeeded}`)
					    console.log(`Quest progress: ${progress}/${secondsNeeded}`)
						
						if(progress >= secondsNeeded) {
							showNotification({
                                title: `Quest completed!`,
                                body: `${applicationName} - quest was successfully completed.`,
					            dismissOnClick: false,
					        })

							RunningGameStore.getRunningGames = realGetRunningGames
							RunningGameStore.getGameForPID = realGetGameForPID
							FluxDispatcher.dispatch({type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: []})
							FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn)
							await claimReward(quest.id, questName)
							doJob()
						}
					}
					FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn)
					
					showNotification({
                    title: `Spoofed your game to: ${applicationName}.`,
                    body: `Wait for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`,
					dismissOnClick: false,
                })
				})
			}
		} else if(taskName === "STREAM_ON_DESKTOP") {
			if(!isApp) {
				showNotification({
                    title: `Use the desktop app to complete the ${applicationName} quest!`,
                    body: `This no longer works in browser for non-video quests.`,
					dismissOnClick: false,
					})
			} else {
				let realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata
				ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
					id: applicationId,
					pid,
					sourceName: null
				})
				
				let fn = async data => {
					let progress = quest.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress.STREAM_ON_DESKTOP.value)
					console.log(`Quest progress: ${progress}/${secondsNeeded}`)
				    console.log(`Quest progress: ${progress}/${secondsNeeded}`)
				    console.log(`Quest progress: ${progress}/${secondsNeeded}`)
					
					if(progress >= secondsNeeded) {
						showNotification({
                            title: `Quest completed!`,
                            body: `${questName} - quest was successfully completed.`,
					        dismissOnClick: false,
					    })

						ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc
						FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn)
						await claimReward(quest.id, questName)
						doJob()
					}
				}
				FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn)
				
				showNotification({
                    title: `Spoofed your stream to ${applicationName}. Stream any window in voice channel for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`,
                    body: `Remember that you need at least 1 other person to be in the voice channel!`,
					dismissOnClick: false,
					})
			}
		} else if(taskName === "PLAY_ACTIVITY") {
			const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id ?? Object.values(GuildChannelStore.getAllGuilds()).find(x => x != null && x.VOCAL.length > 0).VOCAL[0].channel.id
			const streamKey = `call:${channelId}:1`
			
			let fn = async () => {
				showNotification({
                    title: `Completing quest: ${applicationName} - ${questName}`,
                    body: `❤️ Better Quest Completer`,
					dismissOnClick: false,
					})
				
				while(true) {
					const res = await api.post({url: `/quests/${quest.id}/heartbeat`, body: {stream_key: streamKey, terminal: false}})
					const progress = res.body.progress.PLAY_ACTIVITY.value
					console.log(`Quest progress: ${progress}/${secondsNeeded}`)
				    console.log(`Quest progress: ${progress}/${secondsNeeded}`)
				    console.log(`Quest progress: ${progress}/${secondsNeeded}`)
					
					await new Promise(resolve => setTimeout(resolve, 20 * 1000))
					
					if(progress >= secondsNeeded) {
						await api.post({url: `/quests/${quest.id}/heartbeat`, body: {stream_key: streamKey, terminal: true}})
						break
					}
				}
				
				showNotification({
                    title: `Quest completed!`,
                    body: `${questName} - quest was successfully completed.`,
					dismissOnClick: false,
					})				await new Promise(r => setTimeout(r, (settings.store.delayBetweenQuests ?? 5) * 1000))
				doJob()
			}
			fn()
		}
	}
	doJob()
}

}

function QuestButton() {
    return (
        <HeaderBarButton
            tooltip="Better Quest Completer"
            position="bottom"
            className="better-qc-button"
            icon={QuestIcon}
            onClick={runQuestLogic}
        />
    );
}

const settings = definePluginSettings({
    enableNotifications: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show notifications when a quest starts / completes",
    },
    autoStart: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "run on startup",
    },
    delayBetweenQuests: {
        type: OptionType.SLIDER,
        description: "wait between quests (seconds)",
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
        description: "STREAM_ON_DESKTOP",
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

module.exports = definePlugin({
    name: "Better Quest Completer",
    description: "Auto-completes Discord quests instantly — by Naxiwow (github.com/Naxiwow)",
    authors: [
        {
            name: "Naxiwow",
            id: 875342291001278504n,
        },
    ],
			settings,
	

    start() {
        if (settings.store.autoStart) runQuestLogic();
    },

    headerBarButton: {
        icon: QuestIcon,
        render: QuestButton,
    },
});
