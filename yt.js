import ytdl from 'ytdl-core';

export function ytAudioStream(url) {
    return ytdl(url, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
}