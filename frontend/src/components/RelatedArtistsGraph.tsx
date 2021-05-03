import { AsyncOnce } from 'ameo-utils';
import React from 'react';
import { useEffect } from 'react';
import { useRef } from 'react';
import { useQuery } from 'react-query';
import * as R from 'ramda';
import type { Selection } from 'd3';

import { fetchRelatedArtists } from 'src/api';
import { actionCreators, dispatch, getState } from 'src/store';
import { useUsername } from 'src/store/selectors';
import './RelatedArtistsGraph.scss';

interface RelatedArtistsGraphProps {
  relatedArtists: { [artistID: string]: string[] };
}

const D3Module = new AsyncOnce(() => import('d3'));
const WebColaModule = new AsyncOnce(() => import('webcola'));

interface Node {
  artistID: string;
  name: string;
  width: number;
  height: number;
}

interface Link {
  source: number;
  target: number;
}

class RelatedArtistsRenderer {
  private d3: typeof import('d3');
  private d3cola: any;
  private artistIndexByArtistID: Map<string, number> = new Map();
  private orderedArtists: string[] = [];
  private svg: Selection<SVGSVGElement, any, any, any>;
  private allLinksSelection: Selection<any, any, any, any>;
  private allNodesSelection: Selection<any, any, any, any>;
  private allLabelsSelection: Selection<any, any, any, any>;
  private selectedArtistID: string | null = null;
  private links: { source: Node; target: Node }[] = [];
  private nodes: Node[] = [];

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

  public removeSelectedArtist() {
    if (!this.selectedArtistID) {
      return;
    }

    this.svg.node()!.setAttribute('data-artist-selected', 'false');
    document.querySelectorAll('svg .selected').forEach((elem) => elem.classList.remove('selected'));
  }

  public setSelectedArtistID(artistID: string) {
    if (this.selectedArtistID) {
      this.removeSelectedArtist();
    }

    this.selectedArtistID = artistID;
    this.svg.node()!.setAttribute('data-artist-selected', 'true');

    const elems = document.querySelectorAll(`svg .artist-id-${artistID}`);
    elems.forEach((elem) => elem.classList.add('selected'));

    // We need to highlight all nodes connected to this one as well
    const connectedArtistIDs = this.links
      .filter((link) => link.source.artistID === artistID || link.target.artistID === artistID)
      .map((link) =>
        link.source.artistID === artistID ? link.target.artistID : link.source.artistID
      );
    connectedArtistIDs.forEach((artistID) => {
      const elems = document.querySelectorAll(`svg .node.artist-id-${artistID}`);
      elems.forEach((elem) => elem.classList.add('selected'));
    });
  }

  private updateSelections(nodes: Node[], links: Link[]) {
    this.links = links as any;
    this.nodes = nodes;

    this.allLinksSelection = this.svg
      .selectAll('.link')
      .data(links)
      .enter()
      .append('line')
      .attr('class', (d) => {
        const fromArtistID = this.orderedArtists[d.source];
        const toArtistID = this.orderedArtists[d.target];
        return `link artist-id-${fromArtistID} artist-id-${toArtistID}`;
      });

    this.allNodesSelection = this.svg
      .selectAll('.node')
      .data(nodes)
      .enter()
      .append('rect')
      .attr('class', (d) => `node artist-id-${d.artistID}`)
      .attr('width', (d) => d.width)
      .attr('height', (d) => d.height)
      .attr('rx', 5)
      .attr('ry', 5)
      .on('click', (d) => {
        this.d3.event.stopPropagation();
        this.setSelectedArtistID(d.artistID);
      })
      .call(this.d3cola.drag);

    this.allLabelsSelection = this.svg
      .selectAll('.label')
      .data(nodes)
      .enter()
      .append('text')
      .attr('class', (d) => `label artist-id-${d.artistID}`)
      .text((d) => d.name)
      .on('click', (d) => {
        this.d3.event.stopPropagation();
        this.setSelectedArtistID(d.artistID);
      })
      .call(this.d3cola.drag);
  }

  constructor(
    d3: typeof import('d3'),
    cola: any,
    width: number,
    height: number,
    canvas: HTMLDivElement
  ) {
    this.d3 = d3;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', width.toString());
    svg.setAttribute('height', height.toString());
    let randomID = btoa((Math.random() + Math.random()).toString());
    randomID = randomID.slice(0, randomID.length - 2);
    svg.id = randomID;
    canvas.appendChild(svg);
    this.svg = d3.select(`#${randomID}`);
    this.svg.on('click', () => this.removeSelectedArtist());

    this.d3cola = cola
      .d3adaptor(d3)
      .linkDistance(300)
      .symmetricDiffLinkLengths(25)
      .size([width, height]);

    this.updateSelections([], []);
  }

  public setRelatedArtists(relatedArtists: RelatedArtistsGraphProps['relatedArtists']) {
    // Register all artists so that we keep the order static across updates
    const newArtistIDs = Object.keys(relatedArtists).filter((artistID) =>
      this.registerArtist(artistID)
    );

    const canvas = document.createElement('canvas');
    const ctx2d = canvas.getContext('2d')!;
    ctx2d.font = '12px "PT Sans"';

    const allArtists = getState().entityStore.artists;
    const nodes = this.orderedArtists.map((artistID) => {
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
      };
    });
    const links = Object.entries(relatedArtists).flatMap(([artistID, related]) => {
      const sourceIndex = this.artistIndexByArtistID.get(artistID)!;
      return related
        .map((relatedArtistID) => ({
          source: sourceIndex,
          target: this.artistIndexByArtistID.get(relatedArtistID)!,
        }))
        .filter(({ source, target }) => !R.isNil(source) && !R.isNil(target));
    });

    this.updateSelections(nodes, links);

    this.d3cola.nodes(nodes).links(links).start(10, 15, 20);

    this.d3cola.on('tick', () => {
      this.allLinksSelection
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);

      this.allNodesSelection
        .attr('x', (d) => d.x - d.width / 2)
        .attr('y', (d) => d.y - d.height / 2);

      this.allLabelsSelection.attr('x', (d) => d.x - d.width / 2 + 4).attr('y', (d) => d.y + 4);
    });
  }
}

const RelatedArtistsGraph: React.FC<RelatedArtistsGraphProps> = ({ relatedArtists }) => {
  const modules = useRef(Promise.all([D3Module.get(), WebColaModule.get()] as const));
  const container = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    modules.current.then(([d3, webcola]) => {
      if (!container.current) {
        console.error('Loaded modules but container ref is not set');
        return;
      }
      inst.current = new RelatedArtistsRenderer(d3, webcola, 2800, 2800, container.current);
    });
  }, []);
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
          // TODO
          return;
        }

        container.current = ref;
        // TODO
      }}
      className="related-artists-graph"
      style={{ width: 2800, height: 2800 }}
    ></div>
  );
};

export const RelatedArtistsGraphForUser: React.FC = () => {
  const username = useUsername();

  const { data: relatedArtists } = useQuery(['relatedArtists', username], async () => {
    if (!username) {
      return null;
    }

    const res = await fetchRelatedArtists(username);
    if (!res) {
      return null;
    }

    const { extraArtists, relatedArtists } = res;
    dispatch(actionCreators.entityStore.ADD_ARTISTS(extraArtists));
    return relatedArtists;
  });

  return <RelatedArtistsGraph relatedArtists={relatedArtists || {}} />;
};
