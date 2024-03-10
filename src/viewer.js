import {
	AmbientLight,
	AnimationMixer,
	AxesHelper,
	Box3,
	Cache,
	Color,
	DirectionalLight,
	GridHelper,
	HemisphereLight,
	LoaderUtils,
	LoadingManager,
	PMREMGenerator,
	PerspectiveCamera,
	PointsMaterial,
	REVISION,
	Scene,
	SkeletonHelper,
	Vector3,
	WebGLRenderer,
	LinearToneMapping,
	ACESFilmicToneMapping,
} from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { GUI } from 'dat.gui';

import { environments } from './environments.js';

const DEFAULT_CAMERA = '[default]';

const MANAGER = new LoadingManager();
const THREE_PATH = `https://unpkg.com/three@0.${REVISION}.x`;
const DRACO_LOADER = new DRACOLoader(MANAGER).setDecoderPath(
	`${THREE_PATH}/examples/jsm/libs/draco/gltf/`,
);
const KTX2_LOADER = new KTX2Loader(MANAGER).setTranscoderPath(
	`${THREE_PATH}/examples/jsm/libs/basis/`,
);

const IS_IOS = isIOS();

const Preset = { ASSET_GENERATOR: 'assetgenerator' };

Cache.enabled = true;

export class Viewer {
	constructor(el, options) {
		this.el = el;
		this.options = options;

		this.lights = [];
		this.content = null;
		this.mixer = null;
		this.clips = [];
		this.gui = null;

		this.state = {
			// `options`에서 전달받은 값으로 상태 설정
			background: options.background,
			autoRotate: options.autoRotate,
			wireframe: options.wireframe,
			skeleton: options.skeleton,
			grid: options.grid,
			screenSpacePan: options.screenSpacePan,
			pointSize: options.pointSize,
			bgColor: options.bgColor,
			environment: options.environment,
			toneMapping: options.toneMapping,
			exposure: options.exposure,
			punctualLights: options.punctualLights,
			ambientIntensity: options.ambientIntensity,
			ambientColor: options.ambientColor,
			directIntensity: options.directIntensity,
			directColor: options.directColor,
			
			playbackSpeed: 1.0,

			selectedPreset: '',
			// environment:
			// 	options.preset === Preset.ASSET_GENERATOR
			// 		? environments.find((e) => e.id === 'footprint-court').name
			// 		: environments[1].name,
			// background: false,
			// playbackSpeed: 1.0,
			// actionStates: {},
			// camera: DEFAULT_CAMERA,
			// wireframe: false,
			// skeleton: false,
			// grid: false,
			// autoRotate: false,

			// // Lights
			// punctualLights: true,
			// exposure: 0.0,
			// toneMapping: LinearToneMapping,
			// ambientIntensity: 0.3,
			// ambientColor: '#FFFFFF',
			// directIntensity: 0.8 * Math.PI, // TODO(#116)
			// directColor: '#FFFFFF',
			// bgColor: '#191919',

			// pointSize: 1.0,
		};

		this.prevTime = 0;

		this.stats = new Stats();
		this.stats.dom.height = '48px';
		[].forEach.call(this.stats.dom.children, (child) => (child.style.display = ''));

		this.backgroundColor = new Color(this.state.bgColor);

		this.scene = new Scene();
		this.scene.background = this.backgroundColor;

		const fov = options.preset === Preset.ASSET_GENERATOR ? (0.8 * 180) / Math.PI : 60;
		const aspect = el.clientWidth / el.clientHeight;
		this.defaultCamera = new PerspectiveCamera(fov, aspect, 0.01, 1000);
		this.activeCamera = this.defaultCamera;
		this.scene.add(this.defaultCamera);

		this.renderer = window.renderer = new WebGLRenderer({ antialias: true });
		this.renderer.setClearColor(0xcccccc);
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.setSize(el.clientWidth, el.clientHeight);

		this.pmremGenerator = new PMREMGenerator(this.renderer);
		this.pmremGenerator.compileEquirectangularShader();

		this.neutralEnvironment = this.pmremGenerator.fromScene(new RoomEnvironment()).texture;

		this.controls = new OrbitControls(this.defaultCamera, this.renderer.domElement);
		this.controls.screenSpacePanning = true;

		this.el.appendChild(this.renderer.domElement);

		this.cameraCtrl = null;
		this.cameraFolder = null;
		this.animFolder = null;
		this.animCtrls = [];
		this.morphFolder = null;
		this.morphCtrls = [];
		this.skeletonHelpers = [];
		this.gridHelper = null;
		this.axesHelper = null;

		this.addAxesHelper();
		this.addGUI();
		if (options.kiosk) this.gui.close();

		this.animate = this.animate.bind(this);
		requestAnimationFrame(this.animate);
		window.addEventListener('resize', this.resize.bind(this), false);
	}

	animate(time) {
		requestAnimationFrame(this.animate);

		const dt = (time - this.prevTime) / 1000;

		this.controls.update();
		this.stats.update();
		this.mixer && this.mixer.update(dt);
		this.render();

		this.prevTime = time;
	}

	render() {
		this.renderer.render(this.scene, this.activeCamera);
		if (this.state.grid) {
			this.axesCamera.position.copy(this.defaultCamera.position);
			this.axesCamera.lookAt(this.axesScene.position);
			this.axesRenderer.render(this.axesScene, this.axesCamera);
		}
	}

	resize() {
		const { clientHeight, clientWidth } = this.el.parentElement;

		this.defaultCamera.aspect = clientWidth / clientHeight;
		this.defaultCamera.updateProjectionMatrix();
		this.renderer.setSize(clientWidth, clientHeight);

		this.axesCamera.aspect = this.axesDiv.clientWidth / this.axesDiv.clientHeight;
		this.axesCamera.updateProjectionMatrix();
		this.axesRenderer.setSize(this.axesDiv.clientWidth, this.axesDiv.clientHeight);
	}

	load(url, rootPath, assetMap) {
		const baseURL = LoaderUtils.extractUrlBase(url);

		// Load.
		return new Promise((resolve, reject) => {
			// Intercept and override relative URLs.
			MANAGER.setURLModifier((url, path) => {
				// URIs in a glTF file may be escaped, or not. Assume that assetMap is
				// from an un-escaped source, and decode all URIs before lookups.
				// See: https://github.com/donmccurdy/three-gltf-viewer/issues/146
				const normalizedURL =
					rootPath +
					decodeURI(url)
						.replace(baseURL, '')
						.replace(/^(\.?\/)/, '');

				if (assetMap.has(normalizedURL)) {
					const blob = assetMap.get(normalizedURL);
					const blobURL = URL.createObjectURL(blob);
					blobURLs.push(blobURL);
					return blobURL;
				}

				return (path || '') + url;
			});

			const loader = new GLTFLoader(MANAGER)
				.setCrossOrigin('anonymous')
				.setDRACOLoader(DRACO_LOADER)
				.setKTX2Loader(KTX2_LOADER.detectSupport(this.renderer))
				.setMeshoptDecoder(MeshoptDecoder);

			const blobURLs = [];

			loader.load(
				url,
				(gltf) => {
					window.VIEWER.json = gltf;

					const scene = gltf.scene || gltf.scenes[0];
					const clips = gltf.animations || [];

					if (!scene) {
						// Valid, but not supported by this viewer.
						throw new Error(
							'This model contains no scene, and cannot be viewed here. However,' +
								' it may contain individual 3D resources.',
						);
					}

					this.setContent(scene, clips);

					blobURLs.forEach(URL.revokeObjectURL);

					// See: https://github.com/google/draco/issues/349
					// DRACOLoader.releaseDecoderModule();

					resolve(gltf);
				},
				undefined,
				reject,
			);
		});
	}

	/**
	 * @param {THREE.Object3D} object
	 * @param {Array<THREE.AnimationClip} clips
	 */
	setContent(object, clips) {
		this.clear();

		object.updateMatrixWorld(); // donmccurdy/three-gltf-viewer#330

		const box = new Box3().setFromObject(object);
		const size = box.getSize(new Vector3()).length();
		const center = box.getCenter(new Vector3());

		this.controls.reset();

		// object.position.x += object.position.x - center.x;
		// object.position.y += object.position.y - center.y;
		// object.position.z += object.position.z - center.z;
		// this.controls.maxDistance = size * 10;
		// this.defaultCamera.near = size / 100;
		// this.defaultCamera.far = size * 100;
		// this.defaultCamera.updateProjectionMatrix();

		// if (this.options.cameraPosition) {
		// 	this.defaultCamera.position.fromArray(this.options.cameraPosition);
		// 	this.defaultCamera.lookAt(new Vector3());
		// } else {
		// 	this.defaultCamera.position.copy(center);
		// 	this.defaultCamera.position.x += size / 2.0;
		// 	this.defaultCamera.position.y += size / 5.0;
		// 	this.defaultCamera.position.z += size / 2.0;
		// 	this.defaultCamera.lookAt(center);
		// }
		
		// 새로운 카메라 위치 및 FOV 설정을 추가합니다.
		this.defaultCamera.position.set(-5, 7, 10); // 카메라 위치 설정
		this.defaultCamera.fov = 20; // 카메라 FOV 설정
		this.defaultCamera.updateProjectionMatrix(); // 변경사항 적용

		this.setCamera(DEFAULT_CAMERA);

		this.axesCamera.position.copy(this.defaultCamera.position);
		this.axesCamera.lookAt(this.axesScene.position);
		this.axesCamera.near = size / 100;
		this.axesCamera.far = size * 100;
		this.axesCamera.updateProjectionMatrix();
		this.axesCorner.scale.set(size, size, size);

		this.controls.saveState();

		this.scene.add(object);
		this.content = object;

		this.state.punctualLights = true;

		this.content.traverse((node) => {
			if (node.isLight) {
				this.state.punctualLights = false;
			}
		});

		this.setClips(clips);

		this.updateLights();
		this.updateGUI();
		this.updateEnvironment();
		this.updateDisplay();

		window.VIEWER.scene = this.content;

		this.printGraph(this.content);
	}

	printGraph(node) {
		console.group(' <' + node.type + '> ' + node.name);
		node.children.forEach((child) => this.printGraph(child));
		console.groupEnd();
	}

	/**
	 * @param {Array<THREE.AnimationClip} clips
	 */
	setClips(clips) {
		if (this.mixer) {
			this.mixer.stopAllAction();
			this.mixer.uncacheRoot(this.mixer.getRoot());
			this.mixer = null;
		}

		this.clips = clips;
		if (!clips.length) return;

		this.mixer = new AnimationMixer(this.content);
	}

	playAllClips() {
		this.clips.forEach((clip) => {
			this.mixer.clipAction(clip).reset().play();
			this.state.actionStates[clip.name] = true;
		});
	}

	/**
	 * @param {string} name
	 */
	setCamera(name) {
		if (name === DEFAULT_CAMERA) {
			this.controls.enabled = true;
			this.activeCamera = this.defaultCamera;
		} else {
			this.controls.enabled = false;
			this.content.traverse((node) => {
				if (node.isCamera && node.name === name) {
					this.activeCamera = node;
				}
			});
		}
	}

	updateLights() {
		const state = this.state;
		const lights = this.lights;
	
		if (state.punctualLights && !lights.length) {
			this.addLights();
		} else if (!state.punctualLights && lights.length) {
			this.removeLights();
		}
	
		// 'toneMapping' 값을 설정합니다.
		// state.toneMapping 값에 따라 적절한 THREE의 ToneMapping 상수를 할당합니다.
		this.renderer.toneMapping = state.toneMapping === 'LinearToneMapping' ? LinearToneMapping : ACESFilmicToneMapping;
	
		this.renderer.toneMappingExposure = Math.pow(2, state.exposure);
	
		if (lights.length === 2) {
			lights[0].intensity = state.ambientIntensity;
			lights[0].color.set(state.ambientColor);
			lights[1].intensity = state.directIntensity;
			lights[1].color.set(state.directColor);
		}
	}	

	addLights() {
		const state = this.state;

		if (this.options.preset === Preset.ASSET_GENERATOR) {
			const hemiLight = new HemisphereLight();
			hemiLight.name = 'hemi_light';
			this.scene.add(hemiLight);
			this.lights.push(hemiLight);
			return;
		}

		const light1 = new AmbientLight(state.ambientColor, state.ambientIntensity);
		light1.name = 'ambient_light';
		this.defaultCamera.add(light1);

		const light2 = new DirectionalLight(state.directColor, state.directIntensity);
		light2.position.set(0.5, 0, 0.866); // ~60º
		light2.name = 'main_light';
		this.defaultCamera.add(light2);

		this.lights.push(light1, light2);
	}

	removeLights() {
		this.lights.forEach((light) => light.parent.remove(light));
		this.lights.length = 0;
	}

	updateEnvironment() {
		const environment = environments.filter(
			(entry) => entry.name === this.state.environment,
		)[0];

		this.getCubeMapTexture(environment).then(({ envMap }) => {
			this.scene.environment = envMap;
			this.scene.background = this.state.background ? envMap : this.backgroundColor;
		});
	}

	getCubeMapTexture(environment) {
		const { id, path } = environment;

		// neutral (THREE.RoomEnvironment)
		if (id === 'neutral') {
			return Promise.resolve({ envMap: this.neutralEnvironment });
		}

		// none
		if (id === '') {
			return Promise.resolve({ envMap: null });
		}

		return new Promise((resolve, reject) => {
			new EXRLoader().load(
				path,
				(texture) => {
					const envMap = this.pmremGenerator.fromEquirectangular(texture).texture;
					this.pmremGenerator.dispose();

					resolve({ envMap });
				},
				undefined,
				reject,
			);
		});
	}

	updateDisplay() {
		if (this.skeletonHelpers.length) {
			this.skeletonHelpers.forEach((helper) => this.scene.remove(helper));
		}

		traverseMaterials(this.content, (material) => {
			material.wireframe = this.state.wireframe;

			if (material instanceof PointsMaterial) {
				material.size = this.state.pointSize;
			}
		});

		this.content.traverse((node) => {
			if (node.geometry && node.skeleton && this.state.skeleton) {
				const helper = new SkeletonHelper(node.skeleton.bones[0].parent);
				helper.material.linewidth = 3;
				this.scene.add(helper);
				this.skeletonHelpers.push(helper);
			}
		});

		if (this.state.grid !== Boolean(this.gridHelper)) {
			if (this.state.grid) {
				this.gridHelper = new GridHelper();
				this.axesHelper = new AxesHelper();
				this.axesHelper.renderOrder = 999;
				this.axesHelper.onBeforeRender = (renderer) => renderer.clearDepth();
				this.scene.add(this.gridHelper);
				this.scene.add(this.axesHelper);
			} else {
				this.scene.remove(this.gridHelper);
				this.scene.remove(this.axesHelper);
				this.gridHelper = null;
				this.axesHelper = null;
				this.axesRenderer.clear();
			}
		}

		this.controls.autoRotate = this.state.autoRotate;
	}

	updateBackground() {
		this.backgroundColor.set(this.state.bgColor);
	}

	/**
	 * Adds AxesHelper.
	 *
	 * See: https://stackoverflow.com/q/16226693/1314762
	 */
	addAxesHelper() {
		this.axesDiv = document.createElement('div');
		this.el.appendChild(this.axesDiv);
		this.axesDiv.classList.add('axes');

		const { clientWidth, clientHeight } = this.axesDiv;

		this.axesScene = new Scene();
		this.axesCamera = new PerspectiveCamera(50, clientWidth / clientHeight, 0.1, 10);
		this.axesScene.add(this.axesCamera);

		this.axesRenderer = new WebGLRenderer({ alpha: true });
		this.axesRenderer.setPixelRatio(window.devicePixelRatio);
		this.axesRenderer.setSize(this.axesDiv.clientWidth, this.axesDiv.clientHeight);

		this.axesCamera.up = this.defaultCamera.up;

		this.axesCorner = new AxesHelper(5);
		this.axesScene.add(this.axesCorner);
		this.axesDiv.appendChild(this.axesRenderer.domElement);
	}

	addGUI() {
		const gui = (this.gui = new GUI({
			autoPlace: false,
			width: 260,
			hideable: true,
		}));

		// Display controls.
		const dispFolder = gui.addFolder('Display');
		const envBackgroundCtrl = dispFolder.add(this.state, 'background');
		envBackgroundCtrl.onChange(() => this.updateEnvironment());
		const autoRotateCtrl = dispFolder.add(this.state, 'autoRotate');
		autoRotateCtrl.onChange(() => this.updateDisplay());
		const wireframeCtrl = dispFolder.add(this.state, 'wireframe');
		wireframeCtrl.onChange(() => this.updateDisplay());
		const skeletonCtrl = dispFolder.add(this.state, 'skeleton');
		skeletonCtrl.onChange(() => this.updateDisplay());
		const gridCtrl = dispFolder.add(this.state, 'grid');
		gridCtrl.onChange(() => this.updateDisplay());
		dispFolder.add(this.controls, 'screenSpacePanning');
		const pointSizeCtrl = dispFolder.add(this.state, 'pointSize', 1, 16);
		pointSizeCtrl.onChange(() => this.updateDisplay());
		const bgColorCtrl = dispFolder.addColor(this.state, 'bgColor');
		bgColorCtrl.onChange(() => this.updateBackground());

		// Lighting controls.
		const lightFolder = gui.addFolder('Lighting');
		const envMapCtrl = lightFolder.add(
			this.state,
			'environment',
			environments.map((env) => env.name),
		);
		envMapCtrl.onChange(() => this.updateEnvironment());
		[
			// 기존 toneMapping 관련 코드를 주석 처리합니다.
			/* lightFolder.add(this.state, 'toneMapping', {
				Linear: LinearToneMapping,
				'ACES Filmic': ACESFilmicToneMapping,
			}), */
			// 새로운 toneMapping 컨트롤 업데이트 코드를 삽입합니다.
			lightFolder.add(this.state, 'toneMapping', {
				'Linear': 'LinearToneMapping',
				'ACES Filmic': 'ACESFilmicToneMapping'
			}).onChange((value) => {
				// state.toneMapping에 GUI에서 선택한 값을 업데이트합니다.
				this.state.toneMapping = value;
				// toneMapping이 변경되었으므로 lights를 업데이트합니다.
				this.updateLights();
			}),
			lightFolder.add(this.state, 'exposure', -10, 10, 0.01),
			lightFolder.add(this.state, 'punctualLights').listen(),
			lightFolder.add(this.state, 'ambientIntensity', 0, 2),
			lightFolder.addColor(this.state, 'ambientColor'),
			lightFolder.add(this.state, 'directIntensity', 0, 4), // TODO(#116)
			lightFolder.addColor(this.state, 'directColor'),
		].forEach((ctrl) => ctrl.onChange(() => this.updateLights()));


		// Animation controls.
		this.animFolder = gui.addFolder('Animation');
		this.animFolder.domElement.style.display = 'none';
		const playbackSpeedCtrl = this.animFolder.add(this.state, 'playbackSpeed', 0, 1);
		playbackSpeedCtrl.onChange((speed) => {
			if (this.mixer) this.mixer.timeScale = speed;
		});
		this.animFolder.add({ playAll: () => this.playAllClips() }, 'playAll');

		// Morph target controls.
		this.morphFolder = gui.addFolder('Morph Targets');
		this.morphFolder.domElement.style.display = 'none';

		// Camera controls.
		this.cameraFolder = gui.addFolder('Cameras');
		this.cameraFolder.domElement.style.display = 'none';

		// Stats.
		// const perfFolder = gui.addFolder('Performance');
		// const perfLi = document.createElement('li');
		// this.stats.dom.style.position = 'static';
		// perfLi.appendChild(this.stats.dom);
		// perfLi.classList.add('gui-stats');
		// perfFolder.__ul.appendChild(perfLi);

		// Preset.
		// Preset 설정을 위한 새로운 GUI 부분 추가
		// Preset 설정을 위한 GUI 부분 추가
		const presetFolder = this.gui.addFolder('Preset');
		const presetControl = presetFolder.add(this.state, 'selectedPreset', Object.keys(window.presetOptions)).onChange(value => {
			// 선택된 Preset에 따른 Viewer 옵션 업데이트
			const selectedPresetOptions = window.presetOptions[value];
			this.updateViewer(selectedPresetOptions);
		});

		const guiWrap = document.createElement('div');
		this.el.appendChild(guiWrap);
		guiWrap.classList.add('gui-wrap');
		guiWrap.appendChild(gui.domElement);
		gui.open();
	}

	updateGUI() {
		this.cameraFolder.domElement.style.display = 'none';

		this.morphCtrls.forEach((ctrl) => ctrl.remove());
		this.morphCtrls.length = 0;
		this.morphFolder.domElement.style.display = 'none';

		this.animCtrls.forEach((ctrl) => ctrl.remove());
		this.animCtrls.length = 0;
		this.animFolder.domElement.style.display = 'none';

		const cameraNames = [];
		const morphMeshes = [];
		this.content.traverse((node) => {
			if (node.geometry && node.morphTargetInfluences) {
				morphMeshes.push(node);
			}
			if (node.isCamera) {
				node.name = node.name || `VIEWER__camera_${cameraNames.length + 1}`;
				cameraNames.push(node.name);
			}
		});

		if (cameraNames.length) {
			this.cameraFolder.domElement.style.display = '';
			if (this.cameraCtrl) this.cameraCtrl.remove();
			const cameraOptions = [DEFAULT_CAMERA].concat(cameraNames);
			this.cameraCtrl = this.cameraFolder.add(this.state, 'camera', cameraOptions);
			this.cameraCtrl.onChange((name) => this.setCamera(name));
		}

		if (morphMeshes.length) {
			this.morphFolder.domElement.style.display = '';
			morphMeshes.forEach((mesh) => {
				if (mesh.morphTargetInfluences.length) {
					const nameCtrl = this.morphFolder.add(
						{ name: mesh.name || 'Untitled' },
						'name',
					);
					this.morphCtrls.push(nameCtrl);
				}
				for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
					const ctrl = this.morphFolder
						.add(mesh.morphTargetInfluences, i, 0, 1, 0.01)
						.listen();
					Object.keys(mesh.morphTargetDictionary).forEach((key) => {
						if (key && mesh.morphTargetDictionary[key] === i) ctrl.name(key);
					});
					this.morphCtrls.push(ctrl);
				}
			});
		}

		if (this.clips.length) {
			this.animFolder.domElement.style.display = '';
			const actionStates = (this.state.actionStates = {});
			this.clips.forEach((clip, clipIndex) => {
				clip.name = `${clipIndex + 1}. ${clip.name}`;

				// Autoplay the first clip.
				let action;
				if (clipIndex === 0) {
					actionStates[clip.name] = true;
					action = this.mixer.clipAction(clip);
					action.play();
				} else {
					actionStates[clip.name] = false;
				}

				// Play other clips when enabled.
				const ctrl = this.animFolder.add(actionStates, clip.name).listen();
				ctrl.onChange((playAnimation) => {
					action = action || this.mixer.clipAction(clip);
					action.setEffectiveTimeScale(1);
					playAnimation ? action.play() : action.stop();
				});
				this.animCtrls.push(ctrl);
			});
		}
	}

	updateViewer(newOptions) {
		// Viewer 설정 업데이트
		this.scene.background = newOptions.background ? new Color(newOptions.bgColor) : null;
		this.controls.autoRotate = newOptions.autoRotate;
		// Wireframe, Skeleton 등의 옵션들은 특정 조건에서만 적용되므로, 해당 조건을 체크하는 로직이 필요할 수 있습니다.
		// 예를 들어, Mesh 객체에만 wireframe 설정을 적용할 수 있습니다.
		this.content.traverse((node) => {
			if (node.isMesh) {
				node.material.wireframe = newOptions.wireframe;
				// Skeleton, Grid 등의 추가적인 설정도 여기에서 적용할 수 있습니다.
			}
		});
	
		// Grid Helper 표시 여부
		if (newOptions.grid && !this.gridHelper) {
			this.gridHelper = new GridHelper(10, 10);
			this.scene.add(this.gridHelper);
		} else if (!newOptions.grid && this.gridHelper) {
			this.scene.remove(this.gridHelper);
			this.gridHelper = null;
		}
	
		// Grid Helper 표시 여부
		if (newOptions.grid && !this.gridHelper) {
			this.gridHelper = new GridHelper(10, 10);
			this.scene.add(this.gridHelper);
		} else if (!newOptions.grid && this.gridHelper) {
			this.scene.remove(this.gridHelper);
			this.gridHelper = null;
		}
	
		// Skeleton Helper 표시 여부
		this.content.traverse((node) => {
			if (node.isSkinnedMesh) {
				node.skeleton.visible = newOptions.skeleton;
			}
		});
	
		// ScreenSpacePan 설정
		this.controls.screenSpacePan = newOptions.screenSpacePan;
	
		// PointSize 설정 (PointMaterial을 사용하는 객체에 적용)
		this.content.traverse((node) => {
			if (node.material && node.material.type === 'PointsMaterial') {
				node.material.size = newOptions.pointSize;
			}
		});
	
		// 환경 설정
		// `updateEnvironment` 함수 호출 (환경 관련 로직을 해당 함수에 구현)
		this.updateEnvironment(newOptions.environment);
	
		// ToneMapping 설정
		this.renderer.toneMapping = newOptions.toneMapping === 'LinearToneMapping' ? LinearToneMapping : ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = newOptions.exposure;
	
		// 조명 설정
		// `updateLights` 함수를 호출하거나 여기에서 직접 조명을 업데이트
		this.updateLights(newOptions);
	
		// AmbientLight 설정 업데이트
		const ambientLight = this.scene.children.find(child => child instanceof AmbientLight);
		if (ambientLight) {
			ambientLight.intensity = newOptions.ambientIntensity;
			ambientLight.color = new Color(newOptions.ambientColor);
		}

		// DirectionalLight 설정 업데이트
		const directionalLight = this.scene.children.find(child => child instanceof DirectionalLight);
		if (directionalLight) {
			directionalLight.intensity = newOptions.directIntensity;
			directionalLight.color = new Color(newOptions.directColor);
		}
	
		// GUI 컨트롤 업데이트
		const guiUpdateMapping = {
			'background': 'background',
			'autoRotate': 'autoRotate',
			'wireframe': 'wireframe',
			'skeleton': 'skeleton',
			'grid': 'grid',
			'screenSpacePan': 'screenSpacePan',
			'pointSize': 'pointSize',
			'bgColor': 'bgColor',
			'environment': 'environment',
			'toneMapping': 'toneMapping',
			'exposure': 'exposure',
			'punctualLights': 'punctualLights',
			'ambientIntensity': 'ambientIntensity',
			'ambientColor': 'ambientColor',
			'directIntensity': 'directIntensity',
			'directColor': 'directColor'
		};
	
		for (const [option, controlName] of Object.entries(guiUpdateMapping)) {
			const control = this.findGUIControl(controlName);
			if (control) {
				control.setValue(newOptions[option]);
			}
		}
	}
	
	findGUIControl(name) {
		let foundControl = null;
		this.gui.__folders['Display'].__controllers.forEach((control) => {
			if (control.property === name) {
				foundControl = control;
			}
		});
		if (!foundControl && this.gui.__folders['Lighting']) {
			this.gui.__folders['Lighting'].__controllers.forEach((control) => {
				if (control.property === name) {
					foundControl = control;
				}
			});
		}
		return foundControl;
	}

	clear() {
		if (!this.content) return;

		this.scene.remove(this.content);

		// dispose geometry
		this.content.traverse((node) => {
			if (!node.geometry) return;

			node.geometry.dispose();
		});

		// dispose textures
		traverseMaterials(this.content, (material) => {
			for (const key in material) {
				if (key !== 'envMap' && material[key] && material[key].isTexture) {
					material[key].dispose();
				}
			}
		});
	}
}

function traverseMaterials(object, callback) {
	object.traverse((node) => {
		if (!node.geometry) return;
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		materials.forEach(callback);
	});
}

// https://stackoverflow.com/a/9039885/1314762
function isIOS() {
	return (
		['iPad Simulator', 'iPhone Simulator', 'iPod Simulator', 'iPad', 'iPhone', 'iPod'].includes(
			navigator.platform,
		) ||
		// iPad on iOS 13 detection
		(navigator.userAgent.includes('Mac') && 'ontouchend' in document)
	);
}
