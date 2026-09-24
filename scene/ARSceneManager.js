import * as THREE from 'three';

export class ARSceneManager {
    /**
     * @param {THREE.Scene} scene The main Three.js scene
     * @param {THREE.Camera} camera The main camera
     * @param {THREE.WebGLRenderer} renderer The renderer
     */
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;

        this.videoTexture = null;
        this.videoMaterial = null;
        this.bgMesh = null;
        
        this.shadowPlane = null;
        this.isARActive = false;

        this._initVideoBackground();
        this._initShadowCatcher();
    }

    _initVideoBackground() {
        // We use an orthographic setup for the background so it always fills the screen,
        // decoupled from the main perspective camera's movements.
        
        // This mesh will be added to the main scene but will ignore depth 
        // to render behind everything else.
        this.videoMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                opacity: { value: 0.0 },
                uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                uVideoResolution: { value: new THREE.Vector2(1280, 720) },
                mirror: { value: 1.0 } // 1.0 for mirrored, 0.0 for not mirrored
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    // Render as a full screen quad in NDC (Normalized Device Coordinates)
                    gl_Position = vec4(position.xy, 1.0, 1.0); 
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform float opacity;
                uniform float mirror;
                uniform vec2 uResolution;
                uniform vec2 uVideoResolution;
                varying vec2 vUv;
                
                void main() {
                    vec2 uv = vUv;
                    
                    // Aspect ratio cover logic
                    float rs = uResolution.x / uResolution.y;
                    float vs = uVideoResolution.x / uVideoResolution.y;
                    
                    if (rs > vs) {
                        // Screen is wider than video
                        float scale = vs / rs;
                        uv.y = (uv.y - 0.5) * scale + 0.5;
                    } else {
                        // Screen is taller than video
                        float scale = rs / vs;
                        uv.x = (uv.x - 0.5) * scale + 0.5;
                    }
                    
                    if (mirror > 0.5) {
                        uv.x = 1.0 - uv.x;
                    }
                    
                    vec4 texColor = texture2D(tDiffuse, uv);
                    
                    // Subtle vignette
                    float dist = distance(uv, vec2(0.5, 0.5));
                    texColor.rgb *= smoothstep(0.8, 0.2, dist);
                    
                    gl_FragColor = vec4(texColor.rgb, opacity);
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: false
        });

        // 2x2 plane covers the NDC coordinates exactly (-1 to 1)
        const geometry = new THREE.PlaneGeometry(2, 2);
        this.bgMesh = new THREE.Mesh(geometry, this.videoMaterial);
        
        // Ensure it renders first (behind everything)
        this.bgMesh.renderOrder = -999;
        
        // Add to scene but hidden initially
        this.bgMesh.visible = false;
        this.scene.add(this.bgMesh);
    }

    _initShadowCatcher() {
        const geometry = new THREE.PlaneGeometry(100, 100);
        geometry.rotateX(-Math.PI / 2); // Lay flat on XZ plane

        const material = new THREE.ShadowMaterial({ 
            opacity: 0.0, // starts invisible
            transparent: true,
            depthWrite: false
        });

        this.shadowPlane = new THREE.Mesh(geometry, material);
        this.shadowPlane.receiveShadow = true;
        
        // y=0 matches where the car wheels are
        this.shadowPlane.position.y = 0; 
        
        this.shadowPlane.visible = false;
        this.scene.add(this.shadowPlane);
    }

    /**
     * Connects the video element to the scene.
     */
    setVideoElement(videoElement) {
        if (this.videoTexture) {
            this.videoTexture.dispose();
        }
        
        this.videoTexture = new THREE.VideoTexture(videoElement);
        this.videoTexture.minFilter = THREE.LinearFilter;
        this.videoTexture.magFilter = THREE.LinearFilter;
        this.videoTexture.format = THREE.RGBAFormat;
        // The texture shouldn't generate mipmaps for video
        this.videoTexture.generateMipmaps = false;

        this.videoMaterial.uniforms.tDiffuse.value = this.videoTexture;
        
        if (videoElement.videoWidth && videoElement.videoHeight) {
            this.videoMaterial.uniforms.uVideoResolution.value.set(
                videoElement.videoWidth, 
                videoElement.videoHeight
            );
        }
        
        // Listen for resize. setVideoElement() runs on every AR open, so remove
        // any previous listener first — otherwise one leaks per session and they
        // all fire on every resize.
        if (this._onResize) {
            window.removeEventListener('resize', this._onResize);
        }
        this._onResize = () => {
            if (!this.videoMaterial) return;
            this.videoMaterial.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', this._onResize);
    }

    /**
     * Animates the AR background in or out.
     */
    setOpacity(opacity) {
        if (this.videoMaterial) {
            this.videoMaterial.uniforms.opacity.value = opacity;
        }
        if (this.shadowPlane && this.shadowPlane.material) {
            // Shadow opacity maxes out around 0.4 for a soft look
            this.shadowPlane.material.opacity = opacity * 0.4;
        }
    }

    enable() {
        this.isARActive = true;
        this.bgMesh.visible = true;
        this.shadowPlane.visible = true;
    }

    disable() {
        this.isARActive = false;
        // Only hide if opacity is 0 to allow fade outs
        if (this.videoMaterial.uniforms.opacity.value <= 0.01) {
            this.bgMesh.visible = false;
            this.shadowPlane.visible = false;
        }
    }
    
    setMirror(isMirrored) {
        this.videoMaterial.uniforms.mirror.value = isMirrored ? 1.0 : 0.0;
    }

    dispose() {
        if (this._onResize) {
            window.removeEventListener('resize', this._onResize);
        }
        if (this.bgMesh) {
            this.scene.remove(this.bgMesh);
            this.bgMesh.geometry.dispose();
            this.bgMesh.material.dispose();
        }
        if (this.shadowPlane) {
            this.scene.remove(this.shadowPlane);
            this.shadowPlane.geometry.dispose();
            this.shadowPlane.material.dispose();
        }
        if (this.videoTexture) {
            this.videoTexture.dispose();
        }
    }
}
