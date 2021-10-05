import * as Comlink from 'comlink';

export class WasmClient {
  private engine: typeof import('./engine');
  private ctxPtr: number;

  constructor() {
    import('./engine').then((engine) => {
      this.engine = engine;
      this.ctxPtr = engine.create_artist_map_ctx();
    });
  }

  /**
   * Returns the total number of artists in the embedding
   */
  public decodeAndRecordPackedArtistPositions(packed: Uint8Array, isMobile: boolean): number {
    return this.engine.decode_and_record_packed_artist_positions(this.ctxPtr, packed, isMobile);
  }

  public getAllArtistData(): Float32Array {
    const allArtistData = this.engine.get_all_artist_data(this.ctxPtr);
    return Comlink.transfer(allArtistData, [allArtistData.buffer]);
  }

  public isReady() {
    return !!this.engine && !!this.ctxPtr;
  }

  /**
   * Returns set of draw commands to execute
   */
  public handleNewPosition(
    x: number,
    y: number,
    z: number,
    projectedNextX: number,
    projectedNextY: number,
    projectedNextZ: number,
    isFlyMode: boolean
  ) {
    const drawCommands = this.engine.handle_new_position(
      this.ctxPtr,
      x,
      y,
      z,
      projectedNextX,
      projectedNextY,
      projectedNextZ,
      isFlyMode
    );
    return Comlink.transfer(drawCommands, [drawCommands.buffer]);
  }

  /**
   * Returns set of draw commands to execute
   */
  public handleReceivedArtistNames(
    artistIDs: Uint32Array,
    curX: number,
    curY: number,
    curZ: number,
    isFlyMode: boolean
  ) {
    const drawCommands = this.engine.handle_received_artist_names(
      this.ctxPtr,
      artistIDs,
      curX,
      curY,
      curZ,
      isFlyMode
    );
    return Comlink.transfer(drawCommands, [drawCommands.buffer]);
  }

  /**
   * Returns set of draw commands to execute
   */
  public onMusicFinishedPlaying(artistID: number, [curX, curY, curZ]: [number, number, number]) {
    const drawCommands = this.engine.on_music_finished_playing(
      this.ctxPtr,
      artistID,
      curX,
      curY,
      curZ
    );
    return Comlink.transfer(drawCommands, [drawCommands.buffer]);
  }

  /**
   * Returns the new connection data buffer to be rendered
   */
  public handleArtistRelationshipData(
    relationshipData: Uint8Array,
    chunkSize: number,
    chunkIx: number
  ): Float32Array {
    const connectionsBufferLength = this.engine.handle_artist_relationship_data(
      this.ctxPtr,
      relationshipData,
      chunkSize,
      chunkIx
    );
    const connectionsBufferPtr = this.engine.get_connections_buffer_ptr(this.ctxPtr);
    const memory: WebAssembly.Memory = this.engine.get_memory();
    const connectionsBuffer = new Float32Array(
      memory.buffer.slice(connectionsBufferPtr, connectionsBufferPtr + connectionsBufferLength * 4)
    );
    return Comlink.transfer(connectionsBuffer, [connectionsBuffer.buffer]);
  }

  public setHighlightedArtists(
    artistIDs: Uint32Array,
    curX: number,
    curY: number,
    curZ: number,
    isFlyMode: boolean
  ) {
    const drawCommands = this.engine.handle_set_highlighted_artists(
      this.ctxPtr,
      artistIDs,
      curX,
      curY,
      curZ,
      isFlyMode
    );
    return Comlink.transfer(drawCommands, [drawCommands.buffer]);
  }

  public handleArtistManualPlay(artistID: number) {
    const drawCommands = this.engine.handle_artist_manual_play(this.ctxPtr, artistID);
    return Comlink.transfer(drawCommands, [drawCommands.buffer]);
  }

  public getHighlightedConnecionsBackbone(highlightedArtistIDs: Uint32Array): {
    intra: Float32Array;
    inter: Float32Array;
  } {
    const intra = this.engine.get_connections_for_artists(this.ctxPtr, highlightedArtistIDs, true);
    const inter = this.engine.get_connections_for_artists(this.ctxPtr, highlightedArtistIDs, false);

    return {
      intra: Comlink.transfer(intra, [intra.buffer]),
      inter: Comlink.transfer(inter, [inter.buffer]),
    };
  }

  /**
   * Clears all existing labels and renders the special orbit-mode labels
   *
   * Returns set of draw commands to execute
   */
  public transitionToOrbitMode(): Uint32Array {
    return this.engine.transition_to_orbit_mode(this.ctxPtr);
  }

  public forceRenderArtistLabel(artistID: number): Uint32Array {
    return this.engine.force_render_artist_label(this.ctxPtr, artistID);
  }
}

Comlink.expose(new WasmClient());
