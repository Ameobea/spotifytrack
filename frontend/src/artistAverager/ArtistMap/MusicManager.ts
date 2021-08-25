/**
 * Keeps track of which artist's music is currently playing and handles fading in/out when changing which artist is playing.
 */

import { getPreviewURLsByInternalID } from '../api';
import {
  MUSIC_DISTANCE_ROLLOFF_FACTOR,
  MUSIC_FADE_IN_TIME_SECS,
  MUSIC_FADE_OUT_TIME_SECS,
} from './conf';

interface PlayingArtist {
  artistID: number;
  pos: { x: number; y: number; z: number };
  panner: PannerNode;
  gain: GainNode;
}

export default class MusicManager {
  private ctx: AudioContext;
  private curPlaying: PlayingArtist | null = null;
  private mainGain: GainNode;

  constructor() {
    this.ctx = new AudioContext();
    this.mainGain = this.ctx.createGain();
    this.mainGain.gain.value = 0.1;
    this.mainGain.connect(this.ctx.destination);
  }

  public startCtx() {
    this.ctx.resume();
  }

  public setListenerPosition(
    pos: { x: number; y: number; z: number },
    cameraForward: { x: number; y: number; z: number },
    cameraUp: { x: number; y: number; z: number }
  ) {
    const listener = this.ctx.listener;

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

  public async startPlaying(
    artistID: number,
    pos: { x: number; y: number; z: number },
    onEnded: () => void
  ) {
    console.log(`start playback; artistID=${artistID}`);
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
    panner.rolloffFactor = MUSIC_DISTANCE_ROLLOFF_FACTOR;

    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;

    const previewURLs = await getPreviewURLsByInternalID(artistID);
    if (!previewURLs || previewURLs.length === 0) {
      console.log('No preview URLs for artist_id=', artistID);
      onEnded();
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

    // TODO: Pick random one
    const url = previewURLs[0];
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
    audioElement.play();

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + MUSIC_FADE_IN_TIME_SECS);
    panner.connect(gain);
    gain.connect(this.mainGain);

    this.curPlaying = { artistID, pos, panner, gain };
  }

  public stopPlaying(artistID: number) {
    console.log(`stop playback; artistID=${artistID}, curID=${this.curPlaying?.artistID}`);
    if (!this.curPlaying || this.curPlaying.artistID !== artistID) {
      if (this.curPlaying)
        console.warn(
          `Not stopping playback because cur playing ID doesn't match; cur=${this.curPlaying?.artistID}, requested=${artistID}`
        );
      return;
    }

    const curPlaying = this.curPlaying;
    this.curPlaying = null;

    curPlaying.gain.gain.cancelScheduledValues(0);
    curPlaying.gain.gain.linearRampToValueAtTime(
      0,
      this.ctx.currentTime + MUSIC_FADE_OUT_TIME_SECS
    );
    setTimeout(() => {
      curPlaying.gain.disconnect(this.mainGain);
      curPlaying.panner.disconnect(curPlaying.gain);
    }, MUSIC_FADE_OUT_TIME_SECS * 1000);
  }
}
