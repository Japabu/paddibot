# PaddiBot

Discord voice bot using yt-dlp to play YouTube audio. Join a voice channel and use:

- `/play url:<video>` — play one video.
- `/playlist url:<playlist>` — shuffle and play a playlist.
- `/loop url:<video>` — repeat a video until stopped.
- `/config autoplay:true` — continue with YouTube recommendations after a video or playlist ends.
- `/config autoplay:false` — stop after the queue ends (the default).
- `/config` — show the saved autoplay setting for this server.

The control panel has Skip, Pause, Resume, Stop, and Shuffle buttons. Use the current panel from the active voice channel. One voice session is supported at a time. Idle or paused playback disconnects after five minutes (`IDLE_TIMEOUT_MINUTES` changes this).

Autoplay uses YouTube's radio mix for the last video, excluding the last 100 played or attempted videos. It keeps the queued tracks first and does not interrupt an explicit loop. Unavailable recommendations are skipped, with up to five attempts per transition. Stop or new playback cancels pending transitions; turning autoplay off cancels a pending recommendation without interrupting audio already playing. No YouTube API key is required.

Settings are saved per server in `data/settings.json`. Mount `/app/data` when using Docker so they survive container replacement. Playback itself is not resumed after a restart.

## Run

Use Node.js 22.12+ and a recent yt-dlp with Node enabled as its JavaScript runtime. Set `TOKEN` and `CLIENT_ID` in `.env`, then run `npm ci` and `npm start`. `YT_DLP_PATH` can select a different yt-dlp executable. The Docker image includes yt-dlp and updates it at startup.

Run `npm test` for playback, cancellation, recommendation filtering, and settings persistence checks. Pushes to `main` build the ARM image and update the image tag in `Japabu/pi-compose`, which the Pi applies automatically.
