import WebGL from 'three/addons/capabilities/WebGL.js';
import { Viewer } from './viewer.js';
import { Validator } from './validator.js';
import { Footer } from './components/footer';
import queryString from 'query-string';

window.VIEWER = {};

if (!(window.File && window.FileReader && window.FileList && window.Blob)) {
    console.error('The File APIs are not fully supported in this browser.');
} else if (!WebGL.isWebGLAvailable()) {
    console.error('WebGL is not supported in this browser.');
}

class App {
    constructor(el, location) {
        const hash = location.hash ? queryString.parse(location.hash) : {};
        this.options = {
            kiosk: Boolean(hash.kiosk),
            model: hash.model || '',
            preset: hash.preset || '',
            cameraPosition: hash.cameraPosition ? hash.cameraPosition.split(',').map(Number) : null,
        };

        this.el = el;
        this.viewer = null;
        this.viewerEl = null;
        this.spinnerEl = el.querySelector('.spinner');
        this.dropEl = el.querySelector('#viewer-container'); // 수정됨
        this.validator = new Validator(el);

        this.hideSpinner();

        if (this.options.kiosk) {
            const headerEl = document.querySelector('header');
            headerEl.style.display = 'none';
        }

        if (this.options.model) {
            this.view(this.options.model, '', new Map());
        }

        this.loadRandomModel();
    }

	/**
	* 지정된 glb 파일 목록 중에서 랜덤하게 하나를 선택하여 로드합니다.
	*/
	loadRandomModel() {
		// const glbFiles = [
		// 	'/public/assets/glb/black.glb',
		// 	'/public/assets/glb/gradient.glb',
		// 	'/public/assets/glb/neon.glb',
		// 	'/public/assets/glb/rainbow.glb',
		// 	'/public/assets/glb/wf.glb',
		// 	'/public/assets/glb/white.glb'
		// ];

		// 파일 목록에서 랜덤하게 하나의 파일을 선택합니다.
		//const randomIndex = Math.floor(Math.random() * glbFiles.length);
		//const selectedFile = glbFiles[randomIndex];

		// 선택된 파일을 Viewer에 로드합니다.
		this.view(selectedFile, '', new Map());
	}

	createViewer() {
        this.viewerEl = document.createElement('div');
        this.viewerEl.classList.add('viewer');
        this.dropEl.appendChild(this.viewerEl);

        // index.html에서 정의된 옵션을 포함하여 Viewer 인스턴스를 생성합니다.
        const viewerOptions = {
            ...this.options,
            ...window.viewerOptions, // index.html에서 정의된 설정을 추가
        };

        this.viewer = new Viewer(this.viewerEl, viewerOptions);
        return this.viewer;
    }

	// applyViewerSettings() {
	// 	if (window.viewerSettings) {
	// 		const settings = window.viewerSettings;
	// 		// 배경 설정
	// 		this.viewer.scene.background = settings.background ? new THREE.Color(settings.bgColor) : null;
	// 		// 자동 회전 설정
	// 		this.viewer.controls.autoRotate = settings.autoRotate;
	// 		// 스크린 공간 패닝 설정
	// 		this.viewer.controls.screenSpacePanning = settings.screenSpacePan;

	// 		// 카메라 위치 설정
	// 		this.viewer.defaultCamera.position.set(-3, 4, 5);

	// 		// 카메라 확대 설정
	// 		this.viewer.defaultCamera.fov = 40;
	// 		this.viewer.defaultCamera.updateProjectionMatrix();

	// 		// pointSize 설정
	// 		this.viewer.defaultPointSize = settings.pointSize;

	// 		// environment 설정
	// 		this.viewer.setEnvironment(settings.environment);

	// 		// 톤 매핑 및 노출 설정
	// 		this.viewer.renderer.toneMapping = THREE[`${settings.toneMapping}ToneMapping`];
	// 		this.viewer.renderer.toneMappingExposure = settings.exposure;

	// 		// punctualLight 설정
	// 		this.viewer.punctualLightsEnabled = settings.punctualLights;
			
			
	// 		// 와이어프레임 설정
	// 		if (settings.wireframe) {
	// 			this.viewer.content.traverse((node) => {
	// 				if (node.isMesh) {
	// 					node.material.wireframe = settings.wireframe;
	// 				}
	// 			});
	// 		}

	// 		// 스켈레톤 설정
	// 		if (settings.skeleton) {
	// 			this.viewer.content.traverse((node) => {
	// 				if (node.isSkinnedMesh) {
	// 					node.skeleton.visible = settings.skeleton;
	// 				}
	// 			});
	// 		}

	// 		// 그리드 설정
	// 		if (settings.grid) {
	// 			this.viewer.grid.visible = settings.grid;
	// 		}

	// 		// 라이트 설정
	// 		if (settings.punctualLights) {
	// 			this.viewer.addLights();
	// 		} else {
	// 			this.viewer.removeLights();
	// 		}
	// 		this.viewer.lights.forEach((light) => {
	// 			if (light.isAmbientLight) {
	// 				light.intensity = settings.ambientIntensity;
	// 				light.color.set(settings.ambientColor);
	// 			} else if (light.isDirectionalLight) {
	// 				light.intensity = settings.directIntensity;
	// 				light.color.set(settings.directColor);
	// 			}
	// 		});

			
	// 	}
	// }


	/**
	 * Passes a model to the viewer, given file and resources.
	 * @param  {File|string} rootFile
	 * @param  {string} rootPath
	 * @param  {Map<string, File>} fileMap
	 */
	view(rootFile, rootPath, fileMap) {
		if (this.viewer) this.viewer.clear();

		const viewer = this.viewer || this.createViewer();

		const fileURL = typeof rootFile === 'string' ? rootFile : URL.createObjectURL(rootFile);

		const cleanup = () => {
			this.hideSpinner();
			if (typeof rootFile === 'object') URL.revokeObjectURL(fileURL);
		};

		viewer
			.load(fileURL, rootPath, fileMap)
			.catch((e) => this.onError(e))
			.then((gltf) => {
				// TODO: GLTFLoader parsing can fail on invalid files. Ideally,
				// we could run the validator either way.
				if (!this.options.kiosk) {
					this.validator.validate(fileURL, rootPath, fileMap, gltf);
				}
				cleanup();
			});
	}

	/**
	 * @param  {Error} error
	 */
	onError(error) {
		let message = (error || {}).message || error.toString();
		if (message.match(/ProgressEvent/)) {
			message = 'Unable to retrieve this file. Check JS console and browser network tab.';
		} else if (message.match(/Unexpected token/)) {
			message = `Unable to parse file content. Verify that this file is valid. Error: "${message}"`;
		} else if (error && error.target && error.target instanceof Image) {
			message = 'Missing texture: ' + error.target.src.split('/').pop();
		}
		window.alert(message);
		console.error(error);
	}

	showSpinner() {
		this.spinnerEl.style.display = '';
	}

	hideSpinner() {
		this.spinnerEl.style.display = 'none';
	}
}

document.body.innerHTML += Footer();

document.addEventListener('DOMContentLoaded', () => {
	const app = new App(document.body, location);

	window.VIEWER.app = app;

	console.info('[glTF Viewer] Debugging data exported as `window.VIEWER`.');
});
