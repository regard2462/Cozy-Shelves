// Winter in the garden, put together: the tracks in the snow (tracks.js) and the frozen lake (ice.js). world.js makes it
// once the garden stands (world.winter) and hands it every frame. It hooks itself into the player: his steps and
// landings leave prints, and while the lake carries him (in winter) the floor, the walkable area and the grip of his feet
// come from ice.js; out of winter, and indoors, the player's own floor and bounds stay as world.js made them.
//   world.tracks is the tracks system for the animals: wildlife.js and birds.js stamp their prints there.
import { Tracks } from './tracks.js';
import { FrozenLake, iceSnow, overIce } from './ice.js';
import { outside } from './outdoor.js';

export class Winter {
  constructor(world) {
    this.world = world;
    this.tracks = world.tracks = new Tracks(world);
    this.ice = new FrozenLake(world);
    // the snow on the ice decides how plain a print is there (tracks.js coverAt)
    this.tracks.iceAt = (x, z) => (this.ice.walkable && overIce(x, z) ? iceSnow(x, z) * 0.7 + 0.3 : null);
    const P = world.player, step = P.onStep, land = P.onLand, floorAt = P.floorAt, bounds = P.bounds;
    P.onStep = (run, pace) => { this.tracks.playerStep(run, pace); step?.(run, pace); };
    P.onLand = (impact) => { this.tracks.playerLand(impact); land?.(impact); };
    const ice = this.ice, out = (x, z) => ice.walkable && outside(x, z);
    P.floorAt = (x, z, ref) => (out(x, z) ? ice.floorAt(x, z, ref) : floorAt(x, z, ref));
    P.bounds = {
      keep: (p, r, feet) => (out(p.x, p.z) ? ice.keep(p, r, feet) : bounds.keep(p, r, feet)),
      free: (x, z, r, feet) => (out(x, z) ? ice.free(x, z, r, feet) : bounds.free(x, z, r, feet)),
    };
    // the grip of the feet: slippery on the ice (player.js)
    P.gripAt = (x, z, feet) => ice.gripAt(x, z, feet);
    this.ice.settle();
  }
  /** The lake is frozen and carries you (the soundscape: no ducks, no lapping water; the steps sound of ice). */
  get frozenLake() { return this.ice.walkable && this.ice.shown > 0.5; }
  update(dt) {
    this.tracks.update(dt);
    this.ice.update(dt);
  }
  /** Jump to the end of what changes slowly (the fresh snow on the ice): the checks and pictures. */
  settle() { this.ice.settle(); }
  info() { return { tracks: this.tracks.info(), ice: this.ice.info() }; }
}
