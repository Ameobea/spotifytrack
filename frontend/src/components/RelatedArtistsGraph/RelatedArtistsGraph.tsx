import {
  AsyncOnce,
  filterNils,
  PromiseResolveType,
  UnreachableException,
  useWindowSize,
} from 'ameo-utils';
import React from 'react';
import { useEffect } from 'react';
import { useRef } from 'react';
import { useQuery } from 'react-query';
import * as R from 'ramda';
import type { Selection } from 'd3';

import { fetchRelatedArtists, fetchRelatedArtistsForUser } from 'src/api';
import { actionCreators, dispatch, getState } from 'src/store';
import { useUsername } from 'src/store/selectors';
import './RelatedArtistsGraph.scss';
import { Artist } from 'src/types';
import RelatedArtistsGraphCanvasRenderer from './CanvasRenderer';

interface RelatedArtistsGraphProps {
  relatedArtists: { [artistID: string]: string[] };
}

const D3Module = new AsyncOnce(() => import('d3'));
const WebColaModule = new AsyncOnce(() => import('webcola'));
const WebColaWasm = new AsyncOnce(async () => {
  const wasm = await import('src/wasm/wasm');
  const memory: WebAssembly.Memory = wasm.get_memory();
  memory.grow(8024);
  console.log(memory);
  return wasm;
});

export interface Node {
  artistID: string;
  name: string;
  width: number;
  height: number;
  /**
   * `true` if this artist is in the top artists of the originating user
   */
  isPrimary: boolean;
}

export interface Link {
  source: number;
  target: number;
}

export class RelatedArtistsRenderer {
  private d3: typeof import('d3');
  private webcolaInst: any;
  /**
   * Mapping of artist spotify ID to index in `orderedArtists`
   */
  private artistIndexByArtistID: Map<string, number> = new Map();
  /**
   * All artists in the graph in a constant order so that new artists/nodes can be added without invaliding
   * old ones since edges are defined in terms of node indices
   */
  private orderedArtists: string[] = [];
  /**
   * D3 selection for the parent SVG of the whole visualization.  It has one child, which is a `g` element
   * which is held as a D3 selection in `this.canvas`
   */
  private svg: Selection<SVGSVGElement, any, any, any>;
  /**
   * This is the parent of all nodes and edges for the visualization.  It facilitates zooming/panning with
   * D3 by hosting the transform that is applied to all child elements.
   */
  private canvas: Selection<SVGGElement, any, any, any>;
  private allLinksSelection: Selection<any, any, any, any>;
  private allNodesSelection: Selection<any, any, any, any>;
  private allLabelsSelection: Selection<any, any, any, any>;
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
  private registerRelatedArtists(relatedArtists: { [artistID: string]: string[] }) {
    Object.entries(relatedArtists).forEach(([artistID, relatedArtistIDs]) => {
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
    this.registerRelatedArtists(relatedArtists.relatedArtists);

    // Only add new nodes if they're not already in the graph
    const newArtistIDs = Object.keys(relatedArtists.relatedArtists).filter((artistID) => {
      const exists = !R.isNil(this.artistIndexByArtistID.get(artistID));
      return !exists;
    });
    const newNodes = RelatedArtistsRenderer.buildNodes(newArtistIDs);

    const newLinks = newArtistIDs
      .flatMap((artistID) => {
        const index = this.registerArtist(artistID);

        const srcArtistIDs = this.backwardsConnections.get(artistID);
        console.log({ artistID, srcArtistIDs });
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

        console.log({ index, srcArtistIndices, dstArtistIndices });

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

    console.log({ newNodes, newLinks });
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

    this.canvasRenderer.addNodes(newNodes, this.rawLinks);

    if (isFirst) {
      this.webcolaInst.start(10, 15, 20);
    }

    this.allLinksSelection = this.canvas
      .selectAll('.link')
      .data(
        this.webcolaInst.links() as { source: Node; target: Node }[],
        (link: { source: Node; target: Node }) =>
          `link-${link.source.artistID}-${link.target.artistID}`
      );
    this.allLinksSelection.enter().append('line');
    // .attr('class', (d: { source: Node; target: Node }) => {
    //   const fromArtistID = d.source.artistID;
    //   const toArtistID = d.target.artistID;
    //   return `link artist-id-${fromArtistID} artist-id-${toArtistID}`;
    // });
    this.allLinksSelection.exit().remove();
    this.allLinksSelection = this.canvas
      .selectAll('.link')
      .data(
        this.webcolaInst.links() as { source: Node; target: Node }[],
        (link: { source: Node; target: Node }) =>
          `link-${link.source.artistID}-${link.target.artistID}`
      );

    this.allNodesSelection = this.canvas
      .selectAll('.node')
      .data(this.webcolaInst.nodes(), (node: Node) => `node-${node.artistID}`);
    this.allNodesSelection.enter().append('rect');
    // .attr('class', (d) => `node artist-id-${d.artistID}`)
    // .attr('width', (d) => d.width)
    // .attr('height', (d) => d.height)
    // .attr('rx', 5)
    // .attr('ry', 5)
    // .on('click', (d: Node) => {
    //   this.d3.event.stopPropagation();
    //   this.setSelectedArtistID(d.artistID);
    // })
    // .on('dblclick', (d: Node) => {
    //   this.d3.event.stopPropagation();
    //   this.loadConnections(d);
    // })
    // .call(this.webcolaInst.drag);
    this.allNodesSelection.exit().remove();
    this.allNodesSelection = this.canvas
      .selectAll('.node')
      .data(this.webcolaInst.nodes(), (node: Node) => `node-${node.artistID}`);

    this.allLabelsSelection = this.canvas
      .selectAll('.label')
      .data(this.webcolaInst.nodes(), (node: Node) => `label-${node.artistID}`);
    this.allLabelsSelection.enter().append('text');
    // .attr('class', (d: Node) => `label artist-id-${d.artistID}`)
    // .text((d) => d.name)
    // .on('click', (d: Node) => {
    //   this.d3.event.stopPropagation();
    //   this.setSelectedArtistID(d.artistID);
    // })
    // .on('dblclick', (d: Node) => {
    //   this.d3.event.stopPropagation();
    //   this.loadConnections(d);
    // })
    // .call(this.webcolaInst.drag);
    this.allLabelsSelection.exit().remove();
    this.allLabelsSelection = this.canvas
      .selectAll('.label')
      .data(this.webcolaInst.nodes(), (node: Node) => `label-${node.artistID}`);

    if (!isFirst) this.webcolaInst.start();
  }

  constructor(
    d3: typeof import('d3'),
    cola: any,
    webcolaWasm: PromiseResolveType<ReturnType<typeof WebColaWasm.get>>,
    width: number,
    height: number,
    container: HTMLDivElement,
    canvas: HTMLCanvasElement
  ) {
    this.d3 = d3;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', width.toString());
    svg.setAttribute('height', height.toString());
    let randomID = btoa((Math.random() + Math.random()).toString());
    randomID = randomID.slice(0, randomID.length - 2);
    svg.id = randomID;
    container.appendChild(svg);
    this.svg = d3.select(`#${randomID}`);
    this.svg.call(
      d3.zoom().on('zoom', () => {
        this.canvas.attr('transform', d3.event.transform);
      })
    );
    this.canvas = this.svg.append('g');

    this.webcolaInst = new cola.Layout()
      .linkDistance(300)
      .symmetricDiffLinkLengths(25)
      .size([width, height]);
    this.webcolaInst.wasm = webcolaWasm;
    console.log(this.webcolaInst, cola);

    this.canvasRenderer = new RelatedArtistsGraphCanvasRenderer(
      canvas,
      height,
      width,
      this.webcolaInst,
      this
    );
  }

  private static buildNode(
    allArtists: {
      [artistId: string]: Artist | undefined;
    },
    ctx2d: CanvasRenderingContext2D,
    artistID: string
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
      isPrimary: true,
    };
  }

  private static buildNodes(artistIDs: string[]): Node[] {
    const canvas = document.createElement('canvas');
    const ctx2d = canvas.getContext('2d')!;
    ctx2d.font = '12px "PT Sans"';
    const allArtists = getState().entityStore.artists;

    return artistIDs.map((artistID) =>
      RelatedArtistsRenderer.buildNode(allArtists, ctx2d, artistID)
    );
  }

  public setRelatedArtists(relatedArtists: RelatedArtistsGraphProps['relatedArtists']) {
    this.registerRelatedArtists(relatedArtists);

    // Register all artists so that we keep the order static across updates
    const newArtistIDs = Object.keys(relatedArtists).filter((artistID) =>
      this.registerArtist(artistID)
    );

    const nodes = RelatedArtistsRenderer.buildNodes(this.orderedArtists);
    const links = Object.entries(relatedArtists).flatMap(([artistID, related]) => {
      const sourceIndex = this.artistIndexByArtistID.get(artistID)!;
      return related
        .map((relatedArtistID) => ({
          source: sourceIndex,
          target: this.artistIndexByArtistID.get(relatedArtistID)!,
        }))
        .filter(({ source, target }) => !R.isNil(source) && !R.isNil(target));
    });

    this.webcolaInst.nodes(this.nodes).links(this.links);
    this.updateSelections(nodes, links, true);

    // const ctx = this;
    // this.webcolaInst.on('tick', () => {
    //   // this.allLinksSelection.each(function (this: SVGLineElement, d: any) {
    //   //   this.x1.baseVal.value = d.source.x;
    //   //   this.y1.baseVal.value = d.source.y;
    //   //   this.x2.baseVal.value = d.target.x;
    //   //   this.y2.baseVal.value = d.target.y;
    //   // });

    //   // this.allLinksSelection
    //   //   .attr('x1', (d) => d.source.x)
    //   //   .attr('y1', (d) => d.source.y)
    //   //   .attr('x2', (d) => d.target.x)
    //   //   .attr('y2', (d) => d.target.y);

    //   // this.allNodesSelection
    //   //   .attr('x', (d) => d.x - d.width / 2)
    //   //   .attr('y', (d) => d.y - d.height / 2);

    //   this.allNodesSelection.each(function (this: SVGRectElement, d: any, i) {
    //     ctx.canvasRenderer.setNodePos(i, d.x - d.width / 2, d.y - d.height / 2);
    //     // this.x.baseVal.value = d.x - d.width / 2;
    //     // this.y.baseVal.value = d.y - d.height / 2;
    //   });

    //   // if (didIter) {
    //   //   this.allLabelsSelection.each(function (this: SVGTextElement, d: any) {
    //   //     this.x.baseVal[0].value = d.x - d.width / 2 + 4;
    //   //     this.y.baseVal[0].value = d.y + 4;
    //   //   });
    //   // } else {
    //   //   this.allLabelsSelection.attr('x', (d) => d.x - d.width / 2 + 4).attr('y', (d) => d.y + 4);
    //   // }

    //   didIter = true;
    // });
  }

  public setSize(width: number, height: number) {
    console.log({ width, height });
    this.svg.node()!.setAttribute('width', width.toString());
    this.svg.node()!.setAttribute('height', height.toString());
  }
}

const RelatedArtistsGraph: React.FC<RelatedArtistsGraphProps> = ({ relatedArtists }) => {
  const modules = useRef(
    Promise.all([D3Module.get(), WebColaModule.get(), WebColaWasm.get()] as const)
  );
  const container = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const windowSize = useWindowSize();
  const width = windowSize.width - 50;
  const height = windowSize.height * 0.9;
  useEffect(() => {
    modules.current.then(([d3, webcola, webcolaWasm]) => {
      if (!container.current || !canvas.current) {
        console.error('Loaded modules but container ref is not set');
        return;
      }
      if (inst.current) {
        return;
      }
      inst.current = new RelatedArtistsRenderer(
        d3,
        webcola,
        webcolaWasm,
        width,
        height,
        container.current,
        canvas.current
      );
    });
  }, [height, width]);
  useEffect(() => {
    if (!inst.current) {
      return;
    }
    inst.current.setSize(width, height);
  }, [width, height]);

  const inst = useRef<RelatedArtistsRenderer | null>(null);
  const didSet = useRef(false);
  useEffect(() => {
    if (!inst.current || Object.keys(relatedArtists).length === 0 || didSet.current) {
      return;
    }
    didSet.current = true;

    inst.current.setRelatedArtists(relatedArtists);
  }, [relatedArtists]);

  return (
    <div
      ref={(ref) => {
        if (!ref) {
          return;
        }
        container.current = ref;
      }}
      className="related-artists-graph"
      style={{ width, height }}
    >
      <canvas
        style={{ width, height }}
        ref={(ref) => {
          if (!ref) {
            return;
          }
          canvas.current = ref;
        }}
      />
    </div>
  );
};

export const RelatedArtistsGraphForUser: React.FC = () => {
  const username = useUsername();

  const { data: relatedArtists } = useQuery(['relatedArtists', username], async () => {
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
  });

  return <RelatedArtistsGraph relatedArtists={relatedArtists || {}} />;
};
