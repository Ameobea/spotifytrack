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
  public decodeAndRecordPackedArtistPositions(packed: Uint8Array, isMobile: boolean) {
    this.engine.decode_and_record_packed_artist_positions(this.ctxPtr, packed, isMobile);

    return this.getArtistColorsByID();
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

  private getConnectionsBuffer(): Float32Array {
    const connectionsBufferPtr = this.engine.get_connections_buffer_ptr(this.ctxPtr);
    const connectionsBufferLength = this.engine.get_connections_buffer_length(this.ctxPtr);
    const memory: WebAssembly.Memory = this.engine.get_memory();
    return new Float32Array(
      memory.buffer.slice(connectionsBufferPtr, connectionsBufferPtr + connectionsBufferLength * 4)
    );
  }

  private getConnectionsColorBuffer(): Float32Array {
    const connectionsColorBufferPtr = this.engine.get_connections_color_buffer_ptr(this.ctxPtr);
    const connectionsColorBufferLength = this.engine.get_connections_color_buffer_length(
      this.ctxPtr
    );
    const memory: WebAssembly.Memory = this.engine.get_memory();
    return new Float32Array(
      memory.buffer.slice(
        connectionsColorBufferPtr,
        connectionsColorBufferPtr + connectionsColorBufferLength * 4
      )
    );
  }

  /**
   * Returns the new connection data buffer to be rendered
   */
  public handleArtistRelationshipData(
    relationshipData: Uint8Array,
    chunkSize: number,
    chunkIx: number
  ): { connectionsBuffer: Float32Array; connectionsColorBuffer: Float32Array } {
    this.engine.handle_artist_relationship_data(this.ctxPtr, relationshipData, chunkSize, chunkIx);

    const connectionsBuffer = this.getConnectionsBuffer();
    const connectionsColorBuffer = this.getConnectionsColorBuffer();
    return Comlink.transfer({ connectionsBuffer, connectionsColorBuffer }, [
      connectionsBuffer.buffer,
      connectionsColorBuffer.buffer,
    ]);
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

  public getHighlightedConnectionsBackbone(highlightedArtistIDs: Uint32Array): {
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

  /**
   * Returns a new artist relationships connections buffer to be rendered
   */
  public setQuality(newQuality: number): {
    connectionsBuffer: Float32Array;
    connectionsColorBuffer: Float32Array;
  } {
    this.engine.set_quality(this.ctxPtr, newQuality);
    const connectionsBuffer = this.getConnectionsBuffer();
    const connectionsColorBuffer = this.getConnectionsColorBuffer();
    return Comlink.transfer({ connectionsBuffer, connectionsColorBuffer }, [
      connectionsBuffer.buffer,
      connectionsColorBuffer.buffer,
    ]);
  }

  /**
   * Returns set of draw commands to execute
   */
  public playLastArtist(): Uint32Array {
    return this.engine.play_last_artist(this.ctxPtr);
  }

  public getArtistColorsByID(): Map<number, readonly [number, number, number]> {
    const artistColorsBufferPtr = this.engine.get_artist_colors_buffer_ptr(this.ctxPtr);
    const artistColorsBufferLength = this.engine.get_artist_colors_buffer_length(this.ctxPtr);
    const memory: WebAssembly.Memory = this.engine.get_memory();
    const artistColorsBuffer = new Float32Array(
      memory.buffer.slice(
        artistColorsBufferPtr,
        artistColorsBufferPtr + artistColorsBufferLength * 4
      )
    );
    const artistColorsBufferU32View = new Uint32Array(artistColorsBuffer.buffer);

    const artistColorsByID = new Map<number, readonly [number, number, number]>();
    for (let i = 0; i < artistColorsBufferLength; i += 4) {
      const artistID = artistColorsBufferU32View[i];
      const color = [
        artistColorsBuffer[i + 1],
        artistColorsBuffer[i + 2],
        artistColorsBuffer[i + 3],
      ] as const;
      artistColorsByID.set(artistID, color);
    }

    return artistColorsByID;
  }
}

Comlink.expose(new WasmClient());
