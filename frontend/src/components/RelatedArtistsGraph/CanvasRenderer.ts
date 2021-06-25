import * as PIXI from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import * as R from 'ramda';

// import { getState } from 'src/store';
import type { Artist } from 'src/types';
import * as conf from './conf';
import type { Link, Node, RelatedArtistsRenderer } from './RelatedArtistsGraph';
import { getSentry } from 'src/sentry';

interface CanvasNode {
  node: Node;
  sprite: PIXI.Container;
  pos?: { x: number; y: number };
}

interface DragState {
  dragData: PIXI.InteractionData | null;
  handleDrag: (newPos: PIXI.Point) => void;
  onClick?: () => void;
  onDoubleClick?: (node: Node) => void;
  lastPointerDown: number;
}

const mouseUpListeners: (() => void)[] = [];
window.addEventListener('mouseup', (evt) => {
  if (evt.button !== 0) {
    return;
  }

  mouseUpListeners.forEach((cb) => cb());
  while (mouseUpListeners.length) {
    mouseUpListeners.pop();
  }
});

window.addEventListener('touchend', () => {
  mouseUpListeners.forEach((cb) => cb());
  while (mouseUpListeners.length) {
    mouseUpListeners.pop();
  }
});

const makeDraggable = (
  g: PIXI.Graphics | PIXI.Container,
  parent: DragState,
  layout: any,
  node: Node
) => {
  g.interactive = true;
  g.on('pointerdown', (evt: PIXI.InteractionEvent) => {
    const isTouch = window.TouchEvent && evt.data.originalEvent instanceof window.TouchEvent;
    if ((!isTouch && (evt.data.originalEvent as any).button !== 0) || parent.dragData) {
      return;
    }

    const now = performance.now();
    if (now - parent.lastPointerDown <= 400) {
      // double click
      parent.onDoubleClick?.(node);
      return;
    }
    parent.lastPointerDown = now;
    parent.onClick?.();

    // remove stuck
    mouseUpListeners.forEach((cb) => cb());
    while (mouseUpListeners.length) {
      mouseUpListeners.pop();
    }

    mouseUpListeners.push(() => {
      layout.constructor.dragEnd(node);
      parent.dragData = null;
    });

    layout.constructor.dragStart(node);

    parent.dragData = evt.data;
    evt.stopPropagation();
  }).on('pointermove', (evt) => {
    if (!parent.dragData) {
      return;
    }

    const newPosition = parent.dragData.getLocalPosition(g.parent);
    parent.handleDrag(newPosition);
    evt.stopPropagation();
  });
};

const NodeBackgroundCache: Map<number, PIXI.Texture> = new Map();

export default class RelatedArtistsGraphCanvasRenderer {
  /**
   * Passed in so that we don't have to import the Redux store and we can lazy-load this expensive module
   */
  private getAllArtists: () => { [artistID: string]: Artist | undefined };
  private app: PIXI.Application;
  private nodes: CanvasNode[] = [];
  private links: { source: CanvasNode; target: CanvasNode }[] = [];
  private dirtyNodes = true;
  private edgesGraphics: PIXI.Graphics = new PIXI.Graphics();
  private dragHandler: (node: Node, pos: { x: number; y: number }) => void;
  private layout: any;
  private parent: RelatedArtistsRenderer;
  private container: Viewport;
  private selectedArtistID: string | null = null;
  private selectedLinks: { source: CanvasNode; target: CanvasNode }[] | null = null;
  private selectedLinksGraphics: PIXI.Graphics | null = null;

  private setSelectedArtistID(newSelectedArtistID: string | null) {
    this.selectedArtistID = newSelectedArtistID;
    this.selectedLinks = newSelectedArtistID
      ? this.links.filter(
          (link) =>
            link.source.node.artistID === newSelectedArtistID ||
            link.target.node.artistID === newSelectedArtistID
        )
      : null;

    this.rebuildNodes();

    getSentry()?.captureMessage('setSelectedArtistID', {
      extra: {
        href: window.location.href,
        newSelectedArtistID,
      },
    });
  }

  private getNodeColor(node: Node) {
    if (!this.selectedArtistID) {
      return node.isPrimary
        ? conf.PRIMARY_NODE_COLOR[R.isNil(node.userIndex) ? 0 : node.userIndex + 1]
        : conf.SECONDARY_NODE_COLOR;
    }

    if (this.selectedArtistID === node.artistID) {
      return conf.SELECTED_NODE_COLOR;
    }

    const isConnectedToSelectedNode = this.links.some(
      (link) =>
        (link.source.node.artistID === node.artistID &&
          link.target.node.artistID === this.selectedArtistID) ||
        (link.target.node.artistID === node.artistID &&
          link.source.node.artistID === this.selectedArtistID)
    );
    if (isConnectedToSelectedNode) {
      return node.isPrimary
        ? conf.PRIMARY_CONNECTED_TO_SELECTED_NODE_COLOR[
            R.isNil(node.userIndex) ? 0 : node.userIndex + 1
          ]
        : conf.SECONDARY_CONNECTED_TO_SELECTED_NODE_COLOR;
    }

    return node.isPrimary
      ? conf.DULL_PRIMARY_NODE_COLOR[R.isNil(node.userIndex) ? 0 : node.userIndex + 1]
      : conf.DULL_SECONDARY_NODE_COLOR;
  }

  private buildNodeBackground(node: Node): PIXI.Sprite {
    const roundedWidth = Math.round(node.width);
    const cached = NodeBackgroundCache.get(roundedWidth);
    const sprite = (() => {
      if (cached) {
        return new PIXI.Sprite(cached);
      }

      const g = new PIXI.Graphics();
      g.lineStyle({ width: 1, color: 0x0 });

      g.beginFill(0xffffff);
      g.drawRoundedRect(0, 0, node.width, 20, 4);
      g.endFill();

      const texture = this.app.renderer.generateTexture(g, undefined, 4);
      NodeBackgroundCache.set(roundedWidth, texture);

      return new PIXI.Sprite(texture);
    })();

    sprite.tint = this.getNodeColor(node);
    return sprite;
  }

  private buildNode(
    allArtists: { [artistID: string]: Artist | undefined },
    node: Node
  ): PIXI.Container {
    const label = allArtists[node.artistID]?.name ?? 'Unknown Artst';
    const sprite = this.buildNodeBackground(node);

    const text = new PIXI.Text(label, { fontSize: 12, fontFamily: 'PT Sans', stroke: 0, fill: 0 });
    text.x = 4;
    text.y = 4;
    sprite.x = -node.width / 2;
    sprite.y = -10;

    const container = new PIXI.Container();
    container.interactive = true;
    container.cursor = 'pointer';
    container.addChild(sprite).addChild(text);
    sprite.interactiveChildren = false;
    text.interactiveChildren = false;

    const dragState: DragState = {
      dragData: null,
      handleDrag: (newPos: PIXI.Point) => this.dragHandler(node, newPos),
      onClick: () => this.setSelectedArtistID(node.artistID),
      onDoubleClick: async () => {
        await this.parent.loadConnections(node);
        this.setSelectedArtistID(node.artistID);
      },
      lastPointerDown: 0,
    };
    makeDraggable(container, dragState, this.layout, node);

    return container;
  }

  private rebuildNodes() {
    this.nodes.forEach((node) => {
      (node.sprite.children[0] as PIXI.Sprite).tint = this.getNodeColor(node.node);
    });
    this.dirtyNodes = true;
  }

  private reRenderEdges() {
    // We have to do this check before we mutate self with selected edges graphics de/initialization
    const graphicsData = this.edgesGraphics.geometry.graphicsData;
    const canFastpathEdges =
      graphicsData.length === this.links.length &&
      !(this.selectedLinks && !this.selectedLinksGraphics) &&
      !(!this.selectedLinks && this.selectedLinksGraphics);

    // selected edges overlay
    if (this.selectedLinks) {
      if (this.selectedLinksGraphics) {
        this.container.removeChild(this.selectedLinksGraphics);
        this.selectedLinksGraphics.destroy();
        this.selectedLinksGraphics = null;
      }

      this.selectedLinksGraphics = new PIXI.Graphics().lineStyle({
        width: 2.4,
        color: conf.EDGE_COLOR,
        native: false,
      });
      this.selectedLinks.forEach(({ source, target }) => {
        this.selectedLinksGraphics!.moveTo(source.pos!.x, source.pos!.y);
        this.selectedLinksGraphics!.lineTo(target.pos!.x, target.pos!.y);
      });

      this.container.addChildAt(this.selectedLinksGraphics, 1);
    } else if (this.selectedLinksGraphics) {
      // We remove this here as a way to signal to the above code to disable the optimization where we re-use
      // the line geometry after switching between selected/not-selected modes
      this.container.removeChild(this.selectedLinksGraphics);
      this.selectedLinksGraphics.destroy();
      this.selectedLinksGraphics = null;
    }

    // all other edges
    if (canFastpathEdges) {
      // We can fast-path this by just updating line positions
      this.links.forEach(({ source, target }, i) => {
        const datum = graphicsData[i];

        (datum.shape as any).points[0] = source.pos!.x;
        (datum.shape as any).points[1] = source.pos!.y;
        (datum.shape as any).points[2] = target.pos!.x;
        (datum.shape as any).points[3] = target.pos!.y;
      });
      (this.edgesGraphics.geometry as any).invalidate();
      return;
    }

    const g = new PIXI.Graphics();
    g.lineStyle({
      width: this.links.length > 4000 ? 2 : 1.3,
      color: this.selectedLinks ? conf.DULL_EDGE_COLOR : conf.EDGE_COLOR,
      native: this.links.length > 4000,
    });
    this.links.forEach(({ source, target }) => {
      g.moveTo(source.pos!.x, source.pos!.y);
      g.lineTo(target.pos!.x, target.pos!.y);
    });
    this.container.removeChild(this.edgesGraphics);
    this.edgesGraphics.destroy();
    this.edgesGraphics = g;
    this.container.addChildAt(this.edgesGraphics, 0);
  }

  private buildNodeSprites(nodes: Node[], addChildren = true): CanvasNode[] {
    const allArtists = this.getAllArtists();

    const sprites = nodes.map((node) => {
      const sprite = this.buildNode(allArtists, node);
      if (addChildren) {
        this.container.addChild(sprite);
      }
      return sprite;
    });

    return sprites.map((sprite, i) => ({ node: nodes[i], sprite }));
  }

  constructor(
    canvas: HTMLCanvasElement,
    height: number,
    width: number,
    layout: any,
    parent: RelatedArtistsRenderer,
    getAllArtists: () => { [artistID: string]: Artist | undefined }
  ) {
    this.getAllArtists = getAllArtists;
    this.parent = parent;
    this.layout = layout;
    this.dragHandler = (node, pos) => {
      layout.constructor.drag(node, pos);
      layout.resume();
    };
    this.app = new PIXI.Application({
      antialias: true,
      resolution: 2,
      autoDensity: true,
      view: canvas,
      height,
      width,
      backgroundColor: conf.BACKGROUND_COLOR,
    });

    this.container = new Viewport({
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      worldHeight: height,
      worldWidth: width,
      interaction: this.app.renderer.plugins.interaction,
    });

    // Hack for the embedded standalone graph which is locked to my personal artists
    if (window.location.href.includes('graph.html')) {
      this.container.setTransform(575, 400, 0.82, 0.82);
    }

    this.container.drag().pinch().wheel();

    let containerPointerDownPos = new PIXI.Point(0, 0);
    this.container.cursor = 'grab';
    this.container
      .on('pointerdown', (evt: PIXI.InteractionEvent) => {
        this.container.cursor = 'grabbing';
        containerPointerDownPos = evt.data.getLocalPosition(this.app.stage);
      })
      .on('pointerup', (evt: PIXI.InteractionEvent) => {
        this.container.cursor = 'grab';
        const newPos = evt.data.getLocalPosition(this.app.stage);
        if (newPos.x !== containerPointerDownPos.x || newPos.y !== containerPointerDownPos.y) {
          return;
        }

        this.setSelectedArtistID(null);
      });

    window.addEventListener(
      'wheel',
      (evt) => {
        if (evt.target !== canvas) {
          return;
        }

        evt.preventDefault();
      },
      { passive: false }
    );

    this.app.stage.addChild(this.container);
    this.container.addChild(this.edgesGraphics);

    let isTicking = false;
    layout.kick = () => {
      isTicking = true;
    };

    this.app.ticker.add(() => {
      if (isTicking) {
        layout.tick();
        (layout.nodes() as { x: number; y: number }[]).forEach(({ x, y }, i) =>
          this.setNodePos(i, x, y)
        );
      }

      if (this.dirtyNodes) {
        this.reRenderEdges();
        this.dirtyNodes = false;
      }
    });
  }

  public addNodes(newNodes: Node[], links: Link[]) {
    this.nodes.push(...this.buildNodeSprites(newNodes));
    this.links.push(
      ...links.map(({ source, target }) => ({
        source: this.nodes[source],
        target: this.nodes[target],
      }))
    );
    this.dirtyNodes = true;
  }

  public setNodePos(nodeIx: number, x: number, y: number) {
    this.nodes[nodeIx].pos = { x, y };
    this.nodes[nodeIx].sprite.x = x;
    this.nodes[nodeIx].sprite.y = y;
    this.dirtyNodes = true;
  }
}
