import * as THREE from 'three';

export class ObjectFactory {
    private static materials: THREE.Material[] = [
        new THREE.MeshToonMaterial({ color: 0xff4444 }), // 0 Red
        new THREE.MeshToonMaterial({ color: 0x4444ff }), // 1 Blue
        new THREE.MeshToonMaterial({ color: 0xffff44 }), // 2 Yellow
        new THREE.MeshToonMaterial({ color: 0x44ffff }), // 3 Cyan
        new THREE.MeshToonMaterial({ color: 0xff44ff }), // 4 Magenta
        new THREE.MeshToonMaterial({ color: 0x888888 }), // 5 Gray
        new THREE.MeshToonMaterial({ color: 0x8b4513 }), // 6 Brown
        new THREE.MeshToonMaterial({ color: 0xffa500 }), // 7 Orange
        new THREE.MeshToonMaterial({ color: 0xe0e0e0 }), // 8 White/Light Gray
        new THREE.MeshToonMaterial({ color: 0x333333 }), // 9 Dark Gray
    ];

    private static treeTrunkMat = new THREE.MeshToonMaterial({ color: 0x8b4513 });
    private static pineLeavesMat = new THREE.MeshToonMaterial({ color: 0x2e8b57 });
    private static windowMat = new THREE.MeshToonMaterial({ color: 0x87CEFA });
    private static bushMat = new THREE.MeshToonMaterial({ color: 0x3cb371 }); // MediumSeaGreen
    private static flowerMat = new THREE.MeshToonMaterial({ color: 0xff69b4 }); // HotPink

    // Returns the mesh and a boolean indicating if it's a moving entity
    public static createRandomObject(sizeCategory: 'tiny' | 'small' | 'medium' | 'large'): { mesh: THREE.Mesh | THREE.Group, isMoving: boolean } {
        let obj: THREE.Mesh | THREE.Group;
        let isMoving = false;

        let type = 0;

        if (sizeCategory === 'tiny') {
            type = Math.floor(Math.random() * 4); // 0-3
            switch (type) {
                case 0: obj = this.createFlower(); break;
                case 1: obj = this.createGrassTuft(); break;
                case 2: obj = this.createRock(); break; // Can scale down later
                case 3: obj = this.createMushroom(); break;
                default: obj = this.createFlower();
            }
        } else if (sizeCategory === 'small') {
            type = Math.floor(Math.random() * 4);
            switch (type) {
                case 0: obj = this.createBush(); break;
                case 1: obj = this.createCrate(); break;
                case 2:
                    obj = this.createAnimal();
                    isMoving = true;
                    break;
                case 3: obj = this.createRock(); break;
                default: obj = this.createBush();
            }
        } else if (sizeCategory === 'medium') {
            type = Math.floor(Math.random() * 4);
            switch (type) {
                case 0: obj = this.createPineTree(); break;
                case 1: obj = this.createHouse(); break;
                case 2:
                    obj = this.createCar();
                    isMoving = Math.random() > 0.5; // Some cars drive
                    break;
                case 3: obj = this.createPyramid(); break;
                default: obj = this.createPineTree();
            }
        } else {
            type = Math.floor(Math.random() * 3);
            switch (type) {
                case 0: obj = this.createSkyscraper(); break;
                case 1: obj = this.createCloud(); break;
                case 2: obj = this.createPineTree(); break; // Scaled up later
                default: obj = this.createSkyscraper();
            }
        }

        const box = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        box.getSize(size);

        const volume = size.x * size.y * size.z;
        const radius = Math.max(size.x, size.y, size.z) / 2;

        (obj as any).userData.volume = volume;
        (obj as any).userData.radius = radius;
        (obj as any).userData.isMoving = isMoving;

        if (isMoving) {
            // Give it a random target direction
            (obj as any).userData.moveDir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
            (obj as any).userData.moveSpeed = Math.random() * 2 + 1; // Base speed
        }

        return { mesh: obj, isMoving };
    }

    private static getRandomMaterial() {
        return this.materials[Math.floor(Math.random() * this.materials.length)];
    }

    // --- Tiny Objects ---
    private static createFlower(): THREE.Group {
        const group = new THREE.Group();
        const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 4);
        const stem = new THREE.Mesh(stemGeo, this.bushMat);
        stem.position.y = 0.25;
        stem.castShadow = true;
        group.add(stem);

        const petalGeo = new THREE.IcosahedronGeometry(0.2, 0);
        const petal = new THREE.Mesh(petalGeo, this.flowerMat);
        petal.position.y = 0.5;
        petal.castShadow = true;
        group.add(petal);
        return group;
    }

    private static createGrassTuft(): THREE.Group {
        const group = new THREE.Group();
        const geo = new THREE.ConeGeometry(0.1, 0.4, 3);

        for(let i=0; i<3; i++) {
            const blade = new THREE.Mesh(geo, this.bushMat);
            blade.position.set((Math.random()-0.5)*0.2, 0.2, (Math.random()-0.5)*0.2);
            blade.rotation.x = (Math.random()-0.5)*0.5;
            blade.rotation.z = (Math.random()-0.5)*0.5;
            blade.castShadow = true;
            group.add(blade);
        }
        return group;
    }

    private static createMushroom(): THREE.Group {
        const group = new THREE.Group();
        const stemGeo = new THREE.CylinderGeometry(0.1, 0.15, 0.5, 5);
        const stem = new THREE.Mesh(stemGeo, this.materials[8]);
        stem.position.y = 0.25;
        stem.castShadow = true;
        group.add(stem);

        const capGeo = new THREE.SphereGeometry(0.4, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        const cap = new THREE.Mesh(capGeo, this.materials[0]);
        cap.position.y = 0.5;
        cap.scale.y = 0.6;
        cap.castShadow = true;
        group.add(cap);
        return group;
    }

    // --- Small Objects ---
    private static createBush(): THREE.Mesh {
        const size = Math.random() * 0.5 + 0.5;
        const geo = new THREE.DodecahedronGeometry(size, 1);
        const mesh = new THREE.Mesh(geo, this.bushMat);
        mesh.position.y = size * 0.8;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    private static createCrate(): THREE.Mesh {
        const size = Math.random() * 0.5 + 0.5;
        const geo = new THREE.BoxGeometry(size, size, size);
        const mesh = new THREE.Mesh(geo, this.materials[6]); // Brown
        mesh.position.y = size / 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    private static createAnimal(): THREE.Group {
        const group = new THREE.Group();
        const mat = this.materials[8]; // White (Sheep-like)

        const bodyGeo = new THREE.BoxGeometry(1, 0.8, 1.5);
        const body = new THREE.Mesh(bodyGeo, mat);
        body.position.y = 0.6;
        body.castShadow = true;
        group.add(body);

        const headGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
        const head = new THREE.Mesh(headGeo, this.materials[9]); // Dark face
        head.position.set(0, 0.9, 0.9);
        head.castShadow = true;
        group.add(head);

        return group;
    }

    // --- Medium/Large Objects (Existing, tweaked slightly) ---
    private static createPineTree(): THREE.Group {
        const group = new THREE.Group();
        const trunkHeight = Math.random() * 1.5 + 0.5;
        const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, trunkHeight, 5);
        const trunk = new THREE.Mesh(trunkGeo, this.treeTrunkMat);
        trunk.position.y = trunkHeight / 2;
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        group.add(trunk);

        const layers = Math.floor(Math.random() * 3) + 2;
        for (let i = 0; i < layers; i++) {
            const size = 1.5 - (i * 0.3);
            const leavesGeo = new THREE.ConeGeometry(size, 1.5, 5);
            const leaves = new THREE.Mesh(leavesGeo, this.pineLeavesMat);
            leaves.position.y = trunkHeight + (i * 0.8) + 0.5;
            leaves.castShadow = true;
            leaves.receiveShadow = true;
            group.add(leaves);
        }
        return group;
    }

    private static createHouse(): THREE.Group {
        const group = new THREE.Group();
        const baseMat = this.getRandomMaterial();
        const roofMat = this.materials[0]; // Red roofs look good

        const w = 2 + Math.random();
        const d = 2 + Math.random();
        const h = 1.5 + Math.random();

        const baseGeo = new THREE.BoxGeometry(w, h, d);
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = h / 2;
        base.castShadow = true;
        base.receiveShadow = true;
        group.add(base);

        const roofGeo = new THREE.ConeGeometry(Math.max(w, d) * 0.8, 1.5, 4);
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.rotation.y = Math.PI / 4;
        roof.position.y = h + 0.75;
        roof.castShadow = true;
        roof.receiveShadow = true;
        group.add(roof);

        return group;
    }

    private static createCar(): THREE.Group {
        const group = new THREE.Group();
        const bodyMat = this.getRandomMaterial();

        const bodyGeo = new THREE.BoxGeometry(2, 0.8, 4);
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.6;
        body.castShadow = true;
        group.add(body);

        const topGeo = new THREE.BoxGeometry(1.8, 0.7, 2);
        const top = new THREE.Mesh(topGeo, this.windowMat);
        top.position.y = 1.35;
        top.position.z = -0.5;
        top.castShadow = true;
        group.add(top);

        return group;
    }

    private static createSkyscraper(): THREE.Group {
        const group = new THREE.Group();
        const mat = this.materials[5]; // Mostly gray

        let currentY = 0;
        let width = Math.random() * 2 + 3;
        const tiers = Math.floor(Math.random() * 4) + 2;

        for (let i = 0; i < tiers; i++) {
            const height = Math.random() * 4 + 3;
            const geo = new THREE.BoxGeometry(width, height, width);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.y = currentY + height / 2;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);

            currentY += height;
            width *= 0.8;
        }
        return group;
    }

    private static createPyramid(): THREE.Mesh {
        const size = Math.random() * 4 + 3;
        const geo = new THREE.ConeGeometry(size, size * 0.8, 4);
        const mesh = new THREE.Mesh(geo, this.materials[2]);
        mesh.rotation.y = Math.PI / 4;
        mesh.position.y = (size * 0.8) / 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    private static createRock(): THREE.Mesh {
        const size = Math.random() * 1.5 + 0.5;
        const geo = new THREE.DodecahedronGeometry(size, 0);
        const posAttribute = geo.attributes.position;
        for (let i = 0; i < posAttribute.count; i++) {
            posAttribute.setX(i, posAttribute.getX(i) * (0.8 + Math.random() * 0.4));
            posAttribute.setY(i, posAttribute.getY(i) * (0.8 + Math.random() * 0.4));
            posAttribute.setZ(i, posAttribute.getZ(i) * (0.8 + Math.random() * 0.4));
        }
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, this.materials[5]);
        mesh.position.y = size;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    private static createCloud(): THREE.Group {
        const group = new THREE.Group();
        const mat = new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });

        const puffs = Math.floor(Math.random() * 4) + 3;
        for (let i = 0; i < puffs; i++) {
            const size = Math.random() * 1.5 + 1;
            const geo = new THREE.DodecahedronGeometry(size, 1);
            const puff = new THREE.Mesh(geo, mat);
            puff.position.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 1, (Math.random() - 0.5) * 3);
            group.add(puff);
        }
        group.position.y = 10;
        return group;
    }
}
