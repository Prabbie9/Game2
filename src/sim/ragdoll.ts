// Ragdoll (worker side): capsule bodies per body segment joined by spherical joints (hinges with limits at knees and
// elbows), contacts off between joined segments, collision with the world, vehicles and props. Built from segment
// descriptors measured off the character's pose on the main thread, so any cast body works.
import type RAPIER_NS from '@dimforge/rapier3d-compat';
type R = typeof RAPIER_NS;

export interface SegDesc { pos: number[]; quat: number[]; half: number; radius: number; mass: number; parent: number; anchor: number[]; hinge?: number[]; lim?: [number, number] }
export const RAG_SEG_STRIDE = 7;

export class RagdollSim {
  bodies: RAPIER_NS.RigidBody[] = []; joints: RAPIER_NS.ImpulseJoint[] = [];
  constructor(public RAPIER: R, public world: RAPIER_NS.World, public id: number, segs: SegDesc[], vel: number[], spin: number[]) {
    const RA = RAPIER;
    for (const s of segs) {
      const rb = world.createRigidBody(RA.RigidBodyDesc.dynamic().setTranslation(s.pos[0], s.pos[1], s.pos[2]).setRotation({ x: s.quat[0], y: s.quat[1], z: s.quat[2], w: s.quat[3] })
        .setLinvel(vel[0], vel[1], vel[2]).setAngvel({ x: spin[0], y: spin[1], z: spin[2] }).setLinearDamping(0.05).setAngularDamping(1.2).setCcdEnabled(true).setCanSleep(true));
      // capsule along the body's local Y (segment axis), friction high so bodies come to rest instead of skating
      world.createCollider(RA.ColliderDesc.capsule(Math.max(0.01, s.half), s.radius).setMass(s.mass).setFriction(0.9).setRestitution(0.05), rb);
      this.bodies.push(rb);
    }
    segs.forEach((s, i) => { if (s.parent < 0) return; const a = this.bodies[s.parent], b = this.bodies[i];
      const la = toLocal(a, s.anchor), lb = toLocal(b, s.anchor);
      const jd = s.hinge ? RA.JointData.revolute(la, lb, toLocalDir(a, s.hinge)) : RA.JointData.spherical(la, lb);
      const j = world.createImpulseJoint(jd, a, b, true); j.setContactsEnabled(false);
      if (s.hinge && s.lim) (j as RAPIER_NS.RevoluteImpulseJoint).setLimits(s.lim[0], s.lim[1]);
      this.joints.push(j); });
  }
  /** Mean linear speed (m/s), for settle detection. */
  speed() { let v = 0; for (const b of this.bodies) { const l = b.linvel(); v += Math.hypot(l.x, l.y, l.z); } return v / this.bodies.length; }
  impulse(i: number, imp: number[]) { this.bodies[i]?.applyImpulse({ x: imp[0], y: imp[1], z: imp[2] }, true); }
  pack(buf: Float32Array, o: number) { for (const b of this.bodies) { const p = b.translation(), q = b.rotation(); buf.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], o); o += 7; } buf[o] = this.speed(); }
  get stride() { return this.bodies.length * RAG_SEG_STRIDE + 1; }
  dispose() { for (const j of this.joints) this.world.removeImpulseJoint(j, true); for (const b of this.bodies) this.world.removeRigidBody(b); }
}
function toLocal(b: RAPIER_NS.RigidBody, w: number[]) { const p = b.translation(), q = b.rotation(); return rotInv(q, { x: w[0] - p.x, y: w[1] - p.y, z: w[2] - p.z }); }
function toLocalDir(b: RAPIER_NS.RigidBody, d: number[]) { return rotInv(b.rotation(), { x: d[0], y: d[1], z: d[2] }); }
function rotInv(q: { x: number; y: number; z: number; w: number }, v: { x: number; y: number; z: number }) {
  // rotate v by the conjugate of q
  const x = -q.x, y = -q.y, z = -q.z, w = q.w; const ix = w * v.x + y * v.z - z * v.y, iy = w * v.y + z * v.x - x * v.z, iz = w * v.z + x * v.y - y * v.x, iw = -x * v.x - y * v.y - z * v.z;
  return { x: ix * w + iw * -x + iy * -z - iz * -y, y: iy * w + iw * -y + iz * -x - ix * -z, z: iz * w + iw * -z + ix * -y - iy * -x };
}
