import * as PIXI from 'pixi.js';
import { Viewport } from 'pixi-viewport';

import { getState } from 'src/store';
import { Artist } from 'src/types';
import * as conf from './conf';
import { Link, Node, RelatedArtistsRenderer } from './RelatedArtistsGraph';

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

const makeDraggable = (
  g: PIXI.Graphics | PIXI.Container,
  parent: DragState,
  layout: any,
  node: Node
) => {
  g.interactive = true;
  g.on('pointerdown', (evt: PIXI.InteractionEvent) => {
    console.log('down');
    if ((evt.data.originalEvent as any).button !== 0 || parent.dragData) {
      return;
    }

    const now = performance.now();
    if (now - parent.lastPointerDown <= 400) {
      // double click
      parent.onDoubleClick?.(node);
      return;
    }
    parent.lastPointerDown = now;

    // remove stuck
    mouseUpListeners.forEach((cb) => cb());
    while (mouseUpListeners.length) {
      mouseUpListeners.pop();
    }

    mouseUpListeners.push(() => {
      if (node) layout.constructor.dragEnd(node);
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

export default class RelatedArtistsGraphCanvasRenderer {
  private app: PIXI.Application;
  private nodes: CanvasNode[] = [];
  private links: { source: CanvasNode; target: CanvasNode }[] = [];
  private dirtyNodes = true;
  private edgesGraphics: PIXI.Graphics = new PIXI.Graphics();
  private dragHandler: (node: Node, pos: { x: number; y: number }) => void;
  private layout: any;
  private parent: RelatedArtistsRenderer;
  private container: Viewport;

  private buildNode(
    ctx2d: CanvasRenderingContext2D,
    allArtists: { [artistID: string]: Artist | undefined },
    node: Node
  ): PIXI.Container {
    const label = allArtists[node.artistID]?.name ?? 'Unknown Artst';
    const width = ctx2d.measureText(label).width + 8;
    const g = new PIXI.Graphics();
    g.lineStyle({ width: 1, color: 0x0 });
    g.beginFill(conf.NODE_COLOR);
    g.drawRoundedRect(0, 0, width, 20, 4);
    g.endFill();
    const text = new PIXI.Text(label, { fontSize: 12, fontFamily: 'PT Sans', stroke: 0, fill: 0 });
    text.x = 4;
    text.y = 4;
    g.x = -width / 2;
    g.y = -10;

    const container = new PIXI.Container();
    container.interactive = true;
    container.cursor = 'pointer';
    container.addChild(g).addChild(text);
    // \/ this breaks text randomly
    // container.cacheAsBitmap = true;
    // container.cacheAsBitmapResolution = 8;

    const dragState: DragState = {
      dragData: null,
      handleDrag: (newPos: PIXI.Point) => this.dragHandler(node, newPos),
      onClick: () => {
        // TODO
      },
      onDoubleClick: () => this.parent.loadConnections(node),
      lastPointerDown: 0,
    };
    makeDraggable(container, dragState, this.layout, node);

    return container;
  }

  private reRenderEdges() {
    const graphicsData = this.edgesGraphics.geometry.graphicsData;
    if (graphicsData.length === this.links.length) {
      // We can fast-path this by just updating line positions
      this.links.forEach(({ source, target }, i) => {
        const datum = graphicsData[i];
        // datum.points[0] = source.pos!.x;
        // datum.points[1] = source.pos!.y;
        // datum.points[2] = target.pos!.x;
        // datum.points[3] = target.pos!.y;

        (datum.shape as any).points[0] = source.pos!.x;
        (datum.shape as any).points[1] = source.pos!.y;
        (datum.shape as any).points[2] = target.pos!.x;
        (datum.shape as any).points[3] = target.pos!.y;
      });
      (this.edgesGraphics.geometry as any).invalidate();
      return;
    }

    const g = new PIXI.Graphics();
    g.lineStyle({ width: 1, color: conf.EDGE_COLOR, native: this.links.length > 4000 });
    this.links.forEach(({ source, target }) => {
      g.moveTo(source.pos!.x, source.pos!.y);
      g.lineTo(target.pos!.x, target.pos!.y);
    });
    this.container.removeChild(this.edgesGraphics);
    this.edgesGraphics.destroy();
    this.edgesGraphics = g;
    this.container.addChildAt(this.edgesGraphics, 0);
  }

  private buildNodeSprites(nodes: Node[]): CanvasNode[] {
    const canvas = document.createElement('canvas');
    const ctx2d = canvas.getContext('2d')!;
    ctx2d.font = '12px "PT Sans"';

    const sprites = nodes.map((node) => {
      const sprite = this.buildNode(ctx2d, getState().entityStore.artists, node);
      this.container.addChild(sprite);
      return sprite;
    });

    return sprites.map((sprite, i) => ({ node: nodes[i], sprite }));
  }

  constructor(
    canvas: HTMLCanvasElement,
    height: number,
    width: number,
    layout: any,
    parent: RelatedArtistsRenderer
  ) {
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

    this.container.drag().pinch().wheel();

    window.addEventListener(
      'wheel',
      (evt) => {
        if (evt.target !== canvas) {
          return;
        }

        evt.preventDefault();
        // evt.stopPropagation();
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
