<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:09090d,50:7f1d1d,100:dc2626&height=200&section=header&text=Better%20Quest%20Completer&fontSize=46&fontColor=f5f5f5&animation=fadeIn&fontAlignY=38&desc=Equicord%20plugin%20%E2%80%94%20educational%20purposes%20only&descAlignY=58&descSize=16&descColor=a3a3a3" width="100%"/>

<br/>

[![Equicord](https://img.shields.io/badge/Equicord-dc2626?style=for-the-badge&logo=discord&logoColor=white&labelColor=09090d)](https://github.com/Equicord/Equicord)
[![Educational](https://img.shields.io/badge/Educational%20Only-dc2626?style=for-the-badge&logo=bookstack&logoColor=white&labelColor=09090d)](#disclaimer)
[![GitHub](https://img.shields.io/badge/Naxiwow-dc2626?style=for-the-badge&logo=github&logoColor=white&labelColor=09090d)](https://github.com/Naxiwow)

</div>

---

> [!WARNING]
> **This plugin violates Discord's Terms of Service.**
> Using it on your account may result in a permanent ban.
> This project exists **for educational and research purposes only** — to study how Discord's quest system works at the API level.
> I do not encourage, endorse, or take responsibility for any use of this code.

---

## About

Equicord plugin that interacts with Discord's quest API. Built to understand how quest progress tracking, heartbeat endpoints, and reward claiming work under the hood.

Based on the original work by [k4g9](https://github.com/k4g9/discord-quest-completer) — refactored and extended with additional settings.

---

## Features

- Supports all quest types: `WATCH_VIDEO`, `PLAY_ON_DESKTOP`, `STREAM_ON_DESKTOP`, `PLAY_ACTIVITY`, `WATCH_VIDEO_ON_MOBILE`
- Toggle each quest type individually
- Configurable speed multiplier (1x real time → 7x fast)
- Configurable delay between quests
- Notifies you when orb is ready to claim (Discord requires manual click — captcha protected)
- Auto-start on plugin load
- Desktop notifications for each step

---

## Settings

| Setting | Default | Description |
|---|---|---|
| **Enable Notifications** | on | Show notifications for each step |
| **Auto Start** | off | Run automatically when plugin loads |
| **Delay Between Quests** | 5s | Wait between completing multiple quests |
| **Speed Multiplier** | 7 | 1 = real time, 7 = max speed |
| **Auto Claim Orb** | on | Notify when orb is ready (manual click required — Discord captcha-gates `/claim-reward`) |
| **Allow WATCH_VIDEO** | on | Enable this quest type |
| **Allow PLAY_ON_DESKTOP** | on | Enable this quest type |
| **Allow STREAM_ON_DESKTOP** | on | Enable this quest type |
| **Allow PLAY_ACTIVITY** | on | Enable this quest type |
| **Allow WATCH_VIDEO_ON_MOBILE** | on | Enable this quest type |

---

## Installation

Drop the `better-quest-completer` folder into `src/userplugins/` in your Equicord source, then:

```bash
pnpm build
```

Restart Discord → Settings → Plugins → enable **Better Quest Completer**.

---

## Disclaimer

This project is published for **educational purposes only** — specifically to study and document Discord's internal quest API behavior.

- I do **not** encourage using this tool on real accounts
- Using it is a violation of [Discord's Terms of Service](https://discord.com/terms)
- I take **no responsibility** for bans, account terminations, or any consequences resulting from using this code
- This is not a guide on how to cheat Discord's reward system

If you work at Discord and want this taken down, open an issue and I'll comply immediately.

---

## Credits

- [k4g9](https://github.com/k4g9) — original discord-quest-completer
- [Equicord](https://github.com/Equicord/Equicord) — the client mod

---

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:dc2626,50:7f1d1d,100:09090d&height=120&section=footer" width="100%"/>
</div>
