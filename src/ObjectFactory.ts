import * as THREE from 'three';

export class ObjectFactory {
    // Shared materials for better performance
    private static materials: THREE.Material[] = [
        new THREE.MeshToonMaterial({ color: 0xff4444 }), // Red
        new THREE.MeshToonMaterial({ color: 0x4444ff }), // Blue
        new THREE.MeshToonMaterial({ color: 0xffff44 }), // Yellow
        new THREE.MeshToonMaterial({ color: 0x44ffff }), // Cyan
        new THREE.MeshToonMaterial({ color: 0xff44ff }), // Magenta
        new THREE.MeshToonMaterial({ color: 0x888888 }), // Gray
        new THREE.MeshToonMaterial({ color: 0x8b4513 }), // Brown
        new THREE.MeshToonMaterial({ color: 0xffa500 }), // Orange
        new THREE.MeshToonMaterial({ color: 0xe0e0e0 }), // White/Light Gray
        new THREE.MeshToonMaterial({ color: 0x333333 }), // Dark Gray
    ];

    private static treeTrunkMat = new THREE.MeshToonMaterial({ color: 0x8b4513 });
    private static pineLeavesMat = new THREE.MeshToonMaterial({ color: 0x2e8b57 });
    private static windowMat = new THREE.MeshToonMaterial({ color: 0x87CEFA });
    private static blackMat = new THREE.MeshToonMaterial({ color: 0x111111 });

    public static createRandomObject(): THREE.Mesh | THREE.Group {
        // Expand the variety
        const type = Math.floor(Math.random() * 8);

        let obj: THREE.Mesh | THREE.Group;

        switch (type) {
            case 0: obj = this.createPineTree(); break;
            case 1: obj = this.createHouse(); break;
            case 2: obj = this.createCar(); break;
            case 3: obj = this.createSkyscraper(); break;
            case 4: obj = this.createPyramid(); break;
            case 5: obj = this.createRock(); break;
            case 6: obj = this.createCloud(); break;
            case 7: obj = this.createMushroom(); break;
            default: obj = this.createRock(); break;
        }

        // Auto-calculate volume and radius based on exact bounding box
        const box = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        box.getSize(size);

        const volume = size.x * size.y * size.z;
        const radius = Math.max(size.x, size.y, size.z) / 2;

        (obj as any).userData.volume = volume;
        (obj as any).userData.radius = radius;

        return obj;
    }

    private static getRandomMaterial() {
        return this.materials[Math.floor(Math.random() * this.materials.length)];
    }

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
        const roofMat = this.getRandomMaterial();

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
        roof.rotation.y = Math.PI / 4; // Align square base
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

        const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.2, 8);
        wheelGeo.rotateZ(Math.PI / 2);
        const positions = [
            [-1, 0.4, 1.2], [1, 0.4, 1.2],
            [-1, 0.4, -1.2], [1, 0.4, -1.2]
        ];

        for (const pos of positions) {
            const wheel = new THREE.Mesh(wheelGeo, this.blackMat);
            wheel.position.set(pos[0], pos[1], pos[2]);
            wheel.castShadow = true;
            group.add(wheel);
        }

        return group;
    }

    private static createSkyscraper(): THREE.Group {
        const group = new THREE.Group();
        const mat = this.getRandomMaterial();

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
            width *= 0.8; // Next tier is smaller
        }

        return group;
    }

    private static createPyramid(): THREE.Mesh {
        const size = Math.random() * 4 + 3;
        const geo = new THREE.ConeGeometry(size, size * 0.8, 4);
        const mesh = new THREE.Mesh(geo, this.materials[2]); // Yellow-ish
        mesh.rotation.y = Math.PI / 4;
        mesh.position.y = (size * 0.8) / 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    private static createRock(): THREE.Mesh {
        const size = Math.random() * 1.5 + 0.5;
        const geo = new THREE.DodecahedronGeometry(size, 0);
        // Distort vertices slightly for rugged look
        const posAttribute = geo.attributes.position;
        for (let i = 0; i < posAttribute.count; i++) {
            posAttribute.setX(i, posAttribute.getX(i) * (0.8 + Math.random() * 0.4));
            posAttribute.setY(i, posAttribute.getY(i) * (0.8 + Math.random() * 0.4));
            posAttribute.setZ(i, posAttribute.getZ(i) * (0.8 + Math.random() * 0.4));
        }
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, this.materials[5]); // Gray
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
            puff.position.set(
                (Math.random() - 0.5) * 3,
                (Math.random() - 0.5) * 1,
                (Math.random() - 0.5) * 3
            );
            puff.castShadow = true;
            group.add(puff);
        }

        // Elevate clouds slightly
        group.position.y = Math.random() * 5 + 3;
        return group;
    }

    private static createMushroom(): THREE.Group {
        const group = new THREE.Group();

        const stemGeo = new THREE.CylinderGeometry(0.3, 0.4, 1.5, 8);
        const stem = new THREE.Mesh(stemGeo, this.materials[8]); // Light gray/white
        stem.position.y = 0.75;
        stem.castShadow = true;
        group.add(stem);

        const capGeo = new THREE.SphereGeometry(1.2, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        const capMat = this.materials[0]; // Red
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.y = 1.4;
        cap.scale.y = 0.8;
        cap.castShadow = true;
        group.add(cap);

        return group;
    }
}
