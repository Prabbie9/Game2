// Harbourline entry point (M0 shell: renders the sky; the game loop arrives in M1).
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(innerWidth, innerHeight); r.toneMapping = THREE.AgXToneMapping;
document.getElementById('app')!.append(r.domElement);
const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000); cam.position.set(0, 2, 0); cam.lookAt(10, 3, -20);
const scene = new THREE.Scene(); const sky = new Sky(); sky.scale.setScalar(4000); scene.add(sky);
sky.material.uniforms.sunPosition.value.set(-0.6, 0.12, -1).normalize();
r.setAnimationLoop(() => r.render(scene, cam));
