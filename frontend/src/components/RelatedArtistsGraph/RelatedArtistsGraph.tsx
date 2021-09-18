import { AsyncOnce, filterNils, PromiseResolveType, UnreachableException } from 'ameo-utils';
import { useWindowSize } from 'ameo-utils/util/react';
import React, { useMemo } from 'react';
import { useEffect } from 'react';
import { useRef } from 'react';
import { useQuery } from 'react-query';
import * as R from 'ramda';
import type { Layout } from 'webcola';
import { withMobileProp } from 'ameo-utils/dist/responsive';

import { fetchRelatedArtists, fetchRelatedArtistsForUser } from 'src/api';
import { actionCreators, dispatch, getState } from 'src/store';
import './RelatedArtistsGraph.scss';
import { Artist } from 'src/types';
import type RelatedArtistsGraphCanvasRenderer from './CanvasRenderer';

type RelatedArtists = { [artistID: string]: { userIndex?: number; relatedArtistIDs: string[] } };

interface RelatedArtistsGraphProps {
  relatedArtists: RelatedArtists | null | undefined;
  style?: React.CSSProperties;
  mobile: boolean;
  fullHeight?: boolean;
}

const WebColaModule = new AsyncOnce(() => import('webcola'));
const RelatedArtistsGraphCanvasRendererModule = new AsyncOnce(() =>
  import('./CanvasRenderer').then((mod) => mod['default'])
);

export interface Node {
  artistID: string;
  name: string;
  width: number;
  height: number;
  /**
   * `true` if this artist is in the top artists of the originating user
   */
  isPrimary: boolean;
  x: number;
  y: number;
  userIndex?: number;
}

export interface Link {
  source: number;
  target: number;
}

export class RelatedArtistsRenderer {
  private webcolaInst: Layout;
  /**
   * Mapping of artist spotify ID to index in `orderedArtists`
   */
  public artistIndexByArtistID: Map<string, number> = new Map();
  /**
   * All artists in the graph in a constant order so that new artists/nodes can be added without invaliding
   * old ones since edges are defined in terms of node indices
   */
  public orderedArtists: string[] = [];
  /**
   * All links that are currently a part of the graph
   */
  private links: { source: Node; target: Node }[] = [];
  private rawLinks: Link[] = [];
  /**
   * All nodes that are currently a part of the graph
   */
  private nodes: Node[] = [];
  /**
   * Main database containing all artist->related artist connections
   */
  private connections: Map<string, Set<string>> = new Map();
  /**
   * Main database containing all related artist->artist connections
   */
  private backwardsConnections: Map<string, Set<string>> = new Map();
  private canvasRenderer: RelatedArtistsGraphCanvasRenderer;

  /**
   * Populates forwards and backwards connection databases with related artists data
   */
  private registerRelatedArtists(relatedArtists: RelatedArtists) {
    Object.entries(relatedArtists).forEach(([artistID, { relatedArtistIDs }]) => {
      // Forwards mapping
      let forwardEntry = this.connections.get(artistID);
      if (!forwardEntry) {
        this.connections.set(artistID, new Set());
        forwardEntry = this.connections.get(artistID);
      }
      relatedArtistIDs.forEach((relatedID) => forwardEntry!.add(relatedID));

      // Backwards mappings
      relatedArtistIDs.forEach((relatedID) => {
        let backwardEntry = this.backwardsConnections.get(relatedID);
        if (!backwardEntry) {
          this.backwardsConnections.set(relatedID, new Set());
          backwardEntry = this.backwardsConnections.get(relatedID)!;
        }
        backwardEntry!.add(artistID);
      });
    });
  }

  /**
   * The graphing library creates links between nodes by referencing their IDs.  In order to keep a consistent order
   * of artists, we register them all exactly once.  Returns `true` if the artist is new.
   */
  private registerArtist(artistID: string): number {
    const existingIx = this.artistIndexByArtistID.get(artistID);
    if (!R.isNil(existingIx)) {
      return existingIx;
    }

    this.orderedArtists.push(artistID);
    const index = this.orderedArtists.length - 1;
    this.artistIndexByArtistID.set(artistID, index);
    return index;
  }

  /**
   * Loads all related artists for the selected artist, dynamically adding them into the graph and creating
   * links between artists that don't already exist.
   */
  public async loadConnections(node: Node) {
    const relatedArtists = await (async () => {
      try {
        return await fetchRelatedArtists(node.artistID);
      } catch (err) {
        console.error(`Error fetching related artists for artistID=${node.artistID}: `, err);
        return null;
      }
    })();

    if (!relatedArtists) {
      // TODO: Mark this node as already loaded
      return;
    }

    // Add all newly fetched artists to the Redux entity store
    dispatch(actionCreators.entityStore.ADD_ARTISTS(relatedArtists.extraArtists));

    // Register the new related artists into the forwards and backwards databases
    this.registerRelatedArtists(
      Object.fromEntries(
        Object.entries(relatedArtists.relatedArtists).map(([artistID, relatedArtistIDs]) => [
          artistID,
          { userIndex: undefined, relatedArtistIDs },
        ])
      )
    );

    // Only add new nodes if they're not already in the graph
    const nodesToBuild = Object.keys(relatedArtists.relatedArtists)
      .filter((artistID) => {
        const exists = !R.isNil(this.artistIndexByArtistID.get(artistID));
        return !exists;
      })
      .map((artistID) => ({ artistID }));
    const newNodes = this.buildNodes(nodesToBuild, false);

    const newLinks = nodesToBuild
      .flatMap(({ artistID }) => {
        const index = this.registerArtist(artistID);

        const srcArtistIDs = this.backwardsConnections.get(artistID);
        const srcArtistIndices = srcArtistIDs
          ? filterNils(
              Array.from(srcArtistIDs).map((srcArtistID) =>
                this.artistIndexByArtistID.get(srcArtistID)
              )
            )
          : [];

        const dstArtistIDs = this.connections.get(artistID);
        const dstArtistIndices = dstArtistIDs
          ? filterNils(
              Array.from(dstArtistIDs).map((dstArtistID) =>
                this.artistIndexByArtistID.get(dstArtistID)
              )
            )
          : [];

        return [
          ...srcArtistIndices.map((srcIx) => ({ source: srcIx, target: index })),
          ...dstArtistIndices.map((dstIx) => ({ source: index, target: dstIx })),
        ];
      })
      .filter(({ source, target }) => {
        // This isn't great computational-complexity-wise, but it shouldn't matter
        const linkExists = this.links.some((link) => {
          const srcArtistIx = this.artistIndexByArtistID.get(link.source.artistID);
          if (R.isNil(srcArtistIx)) {
            throw new UnreachableException();
          }

          const dstArtistIx = this.artistIndexByArtistID.get(link.target.artistID);
          if (R.isNil(dstArtistIx)) {
            throw new UnreachableException();
          }

          srcArtistIx === source && dstArtistIx === target;
        });
        return !linkExists;
      });

    this.updateSelections(newNodes, newLinks, false);
  }

  private updateSelections(newNodes: Node[], newLinks: Link[], isFirst: boolean) {
    this.nodes.push(...newNodes);
    this.links.push(
      ...R.clone(newLinks).map((link) => ({
        source: this.nodes[link.source],
        target: this.nodes[link.target],
      }))
    );
    this.rawLinks.push(...R.clone(newLinks));

    this.canvasRenderer.addNodes(newNodes, R.clone(newLinks));

    if (isFirst) {
      this.webcolaInst.start(10, 15, 20);
    }

    if (!isFirst) this.webcolaInst.start();
  }

  constructor(
    cola: any,
    RelatedArtistsGraphCanvasRenderer: PromiseResolveType<
      ReturnType<typeof RelatedArtistsGraphCanvasRendererModule.get>
    >,
    width: number,
    height: number,
    canvas: HTMLCanvasElement,
    relatedArtists: RelatedArtists | null | undefined
  ) {
    this.webcolaInst = new cola.Layout()
      .linkDistance(300)
      .symmetricDiffLinkLengths(25)
      .size([width, height]);

    this.canvasRenderer = new RelatedArtistsGraphCanvasRenderer(
      canvas,
      height,
      width,
      this.webcolaInst,
      this,
      () => getState().entityStore.artists
    );

    if (relatedArtists) {
      this.setRelatedArtists(relatedArtists);
    }
  }

  private static buildNode(
    allArtists: {
      [artistId: string]: Artist | undefined;
    },
    ctx2d: CanvasRenderingContext2D,
    artistID: string,
    isPrimary: boolean,
    userIndex: number | undefined
  ): Node {
    const name = allArtists[artistID]?.name;
    if (!name) {
      console.warn('No artist entity found for id=' + artistID);
    }

    const textSize = ctx2d.measureText(name ?? 'Unknown Artist');

    return {
      artistID,
      name: name ?? 'Unknown Artist',
      width: textSize.width + 8,
      height: 20,
      isPrimary,
      userIndex,
      x: 0,
      y: 0,
    };
  }

  private buildNodes(
    artistIDs: { artistID: string; userIndex?: number }[],
    isPrimary: boolean
  ): Node[] {
    const canvas = document.createElement('canvas');
    const ctx2d = canvas.getContext('2d')!;
    ctx2d.font = '12px "PT Sans"';
    const allArtists = getState().entityStore.artists;

    return artistIDs.map(({ artistID, userIndex }) =>
      RelatedArtistsRenderer.buildNode(allArtists, ctx2d, artistID, isPrimary, userIndex)
    );
  }

  public setRelatedArtists(relatedArtists: RelatedArtists) {
    // This is only meant to be called once with the base related artists
    if (this.orderedArtists.length > 0) {
      return;
    }

    this.registerRelatedArtists(relatedArtists);

    // Register all artists so that we keep the order static across updates
    [
      ...Object.keys(relatedArtists),
      // ...Object.values(relatedArtists).flatMap((n) => n),
    ].forEach((artistID) => this.registerArtist(artistID));

    const nodesToBuild = this.orderedArtists.map((artistID) => {
      const userIndex = relatedArtists[artistID]?.userIndex;
      return { artistID, userIndex };
    });
    const nodes = this.buildNodes(nodesToBuild, true);
    const links = Object.entries(relatedArtists).flatMap(([artistID, { relatedArtistIDs }]) => {
      const sourceIndex = this.artistIndexByArtistID.get(artistID)!;
      return relatedArtistIDs
        .map((relatedArtistID) => ({
          source: sourceIndex,
          target: this.artistIndexByArtistID.get(relatedArtistID)!,
        }))
        .filter(({ source, target }) => !R.isNil(source) && !R.isNil(target));
    });

    this.webcolaInst.nodes(this.nodes).links(this.links);
    this.updateSelections(nodes, links, true);
  }

  public setSize(width: number, height: number) {
    // console.log({ width, height });
    // TODO
  }
}

const RelatedArtistsGraphInner: React.FC<RelatedArtistsGraphProps> = ({
  relatedArtists,
  style,
  mobile,
  fullHeight,
}) => {
  const modules = useRef(
    Promise.all([WebColaModule.get(), RelatedArtistsGraphCanvasRendererModule.get()] as const)
  );
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const windowSize = useWindowSize();
  const width = windowSize.width - (mobile ? 0 : 12);
  const height = fullHeight ? windowSize.height : windowSize.height - (mobile ? 0 : 63);

  // The effect that initializes the renderer is async.  If initialization takes longer than it takes to
  // fetch related artists, we need to be able to grab the latest related artists prop without
  // capturing so we use `latestRelatedArtists` for this purpose.
  const latestRelatedArtists = useRef<RelatedArtists | null | undefined>(null);
  useEffect(() => {
    latestRelatedArtists.current = relatedArtists;
  }, [relatedArtists]);
  const inst = useRef<RelatedArtistsRenderer | null>(null);
  useEffect(() => {
    modules.current.then(([webcola, RelatedArtistsGraphCanvasRenderer]) => {
      if (!canvas.current) {
        console.error('Loaded modules but container ref is not set');
        return;
      }
      if (inst.current) {
        return;
      }

      inst.current = new RelatedArtistsRenderer(
        webcola,
        RelatedArtistsGraphCanvasRenderer,
        width,
        height,
        canvas.current,
        latestRelatedArtists.current
      );
    });
  }, [height, width]);
  useEffect(() => {
    if (!inst.current) {
      return;
    }
    inst.current.setSize(width, height);
  }, [width, height]);

  useEffect(() => {
    if (!relatedArtists) {
      return;
    }

    inst.current?.setRelatedArtists(relatedArtists);
  }, [relatedArtists]);

  return (
    <div className="related-artists-graph" style={style}>
      <canvas
        style={{
          width,
          height,
          userSelect: 'none',
          marginLeft: -8,
          marginRight: -8,
          marginBottom: -4,
        }}
        ref={(ref) => {
          if (!ref) {
            return;
          }
          canvas.current = ref;
        }}
        onContextMenu={(evt) => {
          evt.preventDefault();
        }}
      />
    </div>
  );
};

export const RelatedArtistsGraph = withMobileProp({ maxDeviceWidth: 800 })(
  RelatedArtistsGraphInner
);

export const mkFetchAndStoreRelatedArtistsForUser = (
  username: string | null | undefined
) => async () => {
  if (!username) {
    return null;
  }

  const res = await fetchRelatedArtistsForUser(username);
  if (!res) {
    return null;
  }

  const { extraArtists, relatedArtists } = res;
  dispatch(actionCreators.entityStore.ADD_ARTISTS(extraArtists));
  return relatedArtists;
};

interface RelatedArtistsGraphForUserProps {
  style?: React.CSSProperties;
  username: string;
  fullHeight?: boolean;
}

export const RelatedArtistsGraphForUser: React.FC<RelatedArtistsGraphForUserProps> = ({
  style,
  username,
  fullHeight,
}) => {
  const { data: rawRelatedArtists } = useQuery(
    ['relatedArtists', username],
    mkFetchAndStoreRelatedArtistsForUser(username)
  );

  const relatedArtists = useMemo(() => {
    if (!rawRelatedArtists) {
      return null;
    }

    return Object.fromEntries(
      Object.entries(rawRelatedArtists).map(([artistID, relatedArtistIDs]) => [
        artistID,
        { userIndex: undefined, relatedArtistIDs },
      ])
    );
  }, [rawRelatedArtists]);

  return (
    <RelatedArtistsGraph relatedArtists={relatedArtists} style={style} fullHeight={fullHeight} />
  );
};
