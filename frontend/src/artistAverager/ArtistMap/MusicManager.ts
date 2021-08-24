/**
 * Keeps track of which artist's music is currently playing and handles fading in/out when changing which artist is playing.
 */

import { UnreachableException } from 'ameo-utils';

import { getPreviewURLsByInternalID } from '../api';

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

  public async startPlaying(artistID: number, pos: { x: number; y: number; z: number }) {
    if (this.curPlaying) {
      throw new UnreachableException(
        'Tried to start playing while a different artist was already playing'
      );
    }

    const panner = this.ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'linear';
    panner.refDistance = 1;
    panner.rolloffFactor = 10;

    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;

    const previewURLs = await getPreviewURLsByInternalID(artistID);
    if (!previewURLs) {
      // TODO: Send message back to Wasm
      return;
    }

    // TODO: Pick random one
    const url = previewURLs[0];
    const audioElement = new Audio(url);
    audioElement.crossOrigin = 'anonymous';
    const track = this.ctx.createMediaElementSource(audioElement);
    track.connect(panner);
    audioElement.play();

    // TODO: Add event listener to fire back to wasm when playback finishes. Make sure it's cancelled if playback ends early.

    const gain = this.ctx.createGain();
    // TODO: Fade in
    gain.gain.value = 1;
    panner.connect(gain);
    gain.connect(this.mainGain);

    this.curPlaying = { artistID, pos, panner, gain };
  }

  public stopPlaying(artistID: number) {
    if (this.curPlaying && this.curPlaying.artistID !== artistID) {
      throw new UnreachableException(
        'Tried to stop playing while a different artist was already playing'
      );
    }

    if (!this.curPlaying) {
      return;
    }

    // TODO: fade out
    this.curPlaying.gain.disconnect(this.mainGain);
    this.curPlaying.panner.disconnect(this.curPlaying.gain);
    this.curPlaying = null;
  }
}
