/**
 * Keeps track of which artist's music is currently playing and handles fading in/out when changing which artist is playing.
 */

import { getPreviewURLsByInternalID } from './api';
import {
  DEFAULT_VOLUME,
  MIN_MUSIC_PLAY_TIME_SECS,
  MUSIC_DISTANCE_ROLLOFF_FACTOR,
  MUSIC_FADE_IN_TIME_SECS,
  MUSIC_FADE_OUT_TIME_SECS,
} from './conf';

interface PlayingArtist {
  artistID: number;
  pos: { x: number; y: number; z: number };
  panner: PannerNode;
  gain: GainNode;
  startTime: number;
}

const pickPreviewURL = (previewURLs: string[]) => {
  for (let i = 0; i < previewURLs.length; i++) {
    if (Math.random() < 0.4) {
      const subarray = previewURLs.slice(0, i + 1);
      // Pick random element from subarray
      return subarray[Math.floor(Math.random() * subarray.length)];
    }
  }

  return previewURLs[Math.floor(Math.random() * previewURLs.length)];
};

export default class MusicManager {
  private ctx: AudioContext;
  /**
   * Artist that is *actually* playing; music has been fetched, webaudio is initialized, sound is flowing
   */
  public curPlaying: PlayingArtist | null = null;
  /**
   * Artist that has been requested to start playing.  Preview URL is being fetched.
   *
   * This is set when the artist is first requested to start playing.
   */
  private pendingPlayingArtistID: number | null = null;
  private mainGain: GainNode;
  private analyzer: AnalyserNode;
  private curRolloffFactor = MUSIC_DISTANCE_ROLLOFF_FACTOR;

  constructor() {
    this.ctx = new AudioContext();
    this.mainGain = this.ctx.createGain();
    this.analyzer = this.ctx.createAnalyser();
    this.mainGain.connect(this.analyzer);
    this.analyzer.connect(this.ctx.destination);

    this.setVolume(
      localStorage.volume === null || localStorage.volume === undefined
        ? DEFAULT_VOLUME
        : +localStorage.volume
    );
  }

  public startCtx() {
    this.ctx.resume();
  }

  public getCurPlayingMusicVolume() {
    const samples = new Float32Array(this.analyzer.fftSize);
    this.analyzer.getFloatTimeDomainData(samples);
    return Math.max(...samples);
  }

  private lastListenerPosition: {
    pos: { x: number; y: number; z: number };
    cameraForward: { x: number; y: number; z: number };
    cameraUp: { x: number; y: number; z: number };
  } = {
    pos: { x: 0, y: 0, z: 0 },
    cameraForward: { x: 0, y: 0, z: 0 },
    cameraUp: { x: 0, y: 0, z: 0 },
  };

  public setListenerPosition(
    pos: { x: number; y: number; z: number },
    cameraForward: { x: number; y: number; z: number },
    cameraUp: { x: number; y: number; z: number }
  ) {
    if (
      pos.x === this.lastListenerPosition.pos.x &&
      pos.y === this.lastListenerPosition.pos.y &&
      pos.z === this.lastListenerPosition.pos.z &&
      cameraForward.x === this.lastListenerPosition.cameraForward.x &&
      cameraForward.y === this.lastListenerPosition.cameraForward.y &&
      cameraForward.z === this.lastListenerPosition.cameraForward.z &&
      cameraUp.x === this.lastListenerPosition.cameraUp.x &&
      cameraUp.y === this.lastListenerPosition.cameraUp.y &&
      cameraUp.z === this.lastListenerPosition.cameraUp.z
    ) {
      return;
    }
    this.lastListenerPosition = { pos, cameraForward, cameraUp };

    const listener = this.ctx.listener;

    // Firefox :shrug:
    if (
      !listener.positionX ||
      !listener.positionY ||
      !listener.positionZ ||
      !listener.forwardX ||
      !listener.upX
    ) {
      listener.setOrientation?.(
        cameraForward.x,
        cameraForward.y,
        cameraForward.z,
        cameraUp.x,
        cameraUp.y,
        cameraUp.z
      );
      listener.setPosition?.(pos.x, pos.y, pos.z);
    } else {
      listener.positionX.value = pos.x;
      listener.positionY.value = pos.y;
      listener.positionZ.value = pos.z;

      listener.forwardX.value = cameraForward.x;
      listener.forwardY.value = cameraForward.y;
      listener.forwardZ.value = cameraForward.z;
      listener.upX.value = cameraUp.x;
      listener.upY.value = cameraUp.y;
      listener.upZ.value = cameraUp.z;
    }
  }

  public async startPlaying(
    artistID: number,
    pos: { x: number; y: number; z: number },
    onEnded: () => void
  ) {
    this.pendingPlayingArtistID = artistID;
    if (this.curPlaying) {
      console.warn(
        `Tried to start playing while a different artist was already playing; cur_playing=${this.curPlaying.artistID}, requested=${artistID}`
      );
      return;
    }

    const panner = this.ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'linear';
    panner.refDistance = 1;
    panner.rolloffFactor = this.curRolloffFactor;

    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;

    const previewURLs = await getPreviewURLsByInternalID(artistID);
    if (!previewURLs || previewURLs.length === 0) {
      console.log('No preview URLs for artist_id=', artistID);
      onEnded();
      return;
    } else if (this.pendingPlayingArtistID !== artistID) {
      console.warn(
        'A different artist started playing since we fetched preview URLs for artist_id=',
        artistID
      );
      return;
    }

    // Check to see if we were too slow and someone else beat us to start playing
    if ((this.curPlaying as PlayingArtist | null)?.artistID) {
      console.warn(
        `Cur playing artist changed while we were fetching; aborting playback.  artist_id=${artistID}`
      );
      onEnded();
      return;
    }

    const url = pickPreviewURL(previewURLs);
    const audioElement = new Audio(url);
    audioElement.crossOrigin = 'anonymous';
    const track = this.ctx.createMediaElementSource(audioElement);
    track.connect(panner);
    audioElement.addEventListener('ended', () => {
      onEnded();
      if (this.curPlaying?.artistID === artistID) {
        this.curPlaying = null;
      }
    });
    try {
      audioElement.play();
    } catch (_err) {
      // pass, the user probably hasn't clicked the page yet in which case there's nothing we can do until they do so
    }

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + MUSIC_FADE_IN_TIME_SECS);
    panner.connect(gain);
    gain.connect(this.mainGain);

    this.curPlaying = { artistID, pos, panner, gain, startTime: this.ctx.currentTime };
  }

  public stopPlaying(artistID: number) {
    console.log(`stop playback; artistID=${artistID}, curID=${this.curPlaying?.artistID}`);
    if (this.pendingPlayingArtistID === artistID) {
      this.pendingPlayingArtistID = null;
    }
    if (!this.curPlaying || this.curPlaying.artistID !== artistID) {
      if (this.curPlaying)
        console.warn(
          `Not stopping playback because cur playing ID doesn't match; cur=${this.curPlaying?.artistID}, requested=${artistID}`
        );
      return;
    }

    const curPlaying = this.curPlaying;
    this.curPlaying = null;

    const timePlayed = this.ctx.currentTime - curPlaying.startTime;
    const timeToWait = MIN_MUSIC_PLAY_TIME_SECS - timePlayed;
    setTimeout(() => {
      curPlaying.gain.gain.cancelScheduledValues(0);
      curPlaying.gain.gain.linearRampToValueAtTime(
        0,
        this.ctx.currentTime + MUSIC_FADE_OUT_TIME_SECS
      );
      setTimeout(() => {
        curPlaying.gain.disconnect(this.mainGain);
        curPlaying.panner.disconnect(curPlaying.gain);
      }, MUSIC_FADE_OUT_TIME_SECS * 1000);
    }, timeToWait * 1000);
  }

  public setRolloffFactor(newRolloffFactor: number) {
    this.curRolloffFactor = newRolloffFactor;
    if (!this.curPlaying) {
      return;
    }
    this.curPlaying.panner.rolloffFactor = newRolloffFactor;
  }

  /**
   * Sets new volume; should be on a scale from 0 to 1
   */
  public setVolume(newVolume: number) {
    this.mainGain.gain.value = newVolume / 6;
  }
}
