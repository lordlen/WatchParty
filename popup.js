const hostButton = document.querySelector('#host');
const joinButton = document.querySelector('#join');
const goToButton = document.querySelector('#goToPeerUrl');
const nameInput = document.querySelector('#name');
const peerIdInput = document.querySelector('#peer-id');
const urlFinder = document.querySelector('#urlFinder');

chrome.storage.local.get(['name'], result => {
	nameInput.value = result.name;
});

async function getCurrentTab() {
	const queryOptions = {active: true, lastFocusedWindow: true};
	// `tab` will either be a `tabs.Tab` instance or `undefined`.
	const [tab] = await chrome.tabs.query(queryOptions);
	return tab;
}

function saveInputs() {
	chrome.storage.local.set({name: nameInput.value});
}

hostButton.addEventListener('click', async () => {
	const name = nameInput.value;
	const tabId = (await getCurrentTab()).id;
	await chrome.scripting.executeScript({
		target: {tabId},
		files: ['peerjs.min.js'],
	});
	chrome.scripting.executeScript({
		target: {tabId},
		func: hostOrJoin,
		args: [name, null],
	});
	saveInputs();
}, {passive: true});

joinButton.addEventListener('click', async () => {
	const name = nameInput.value;
	const peerId = peerIdInput.value;
	if (!peerId) {
		alert('Enter a peer id');
		return;
	}

	const tabId = (await getCurrentTab()).id;

	await chrome.scripting.executeScript({
		target: {tabId},
		files: ['peerjs.min.js'],
	});
	chrome.scripting.executeScript({
		target: {tabId},
		func: hostOrJoin,
		args: [name, peerId],
	});
	saveInputs();
}, {passive: true});

goToButton.addEventListener('click', async () => {
	const peerId = peerIdInput.value;
	if (!peerId) {
		alert('Enter a peer id');
		return;
	}

	const peer = new Peer(null, {
		debug: 2,
	});
	peer.on('open', () => {
		const conn = peer.connect(peerId);
		conn.on('data', data => {
			if (data.action === 'returnUrl') {
				const {url} = data;
				chrome.tabs.create({url});
				peer.destroy();
			}
		});
		conn.on('open', () => {
			conn.send({action: 'getUrl'});
		});
	});
}, {passive: true});

urlFinder.addEventListener('click', async () => {
	const tabId = (await getCurrentTab()).id;

	chrome.scripting.executeScript({
		target: {tabId},
		func: findUrl,
	});
});

chrome.runtime.onMessage.addListener(
	async request => {
		switch (request.action) {
			case 'returnUrl': {
				const {url} = request;
				if (confirm(`Are you sure you want to open a new tab to ${url}?`)) {
					chrome.tabs.create({url});
				}

				break;
			}

			default:
				break;
		}
	},
);

function hostOrJoin(myName, hostId) {
	const party = {};

	const peer = new Peer(null, {
		debug: 2,
	});

	const videoElem = document.querySelector('video');
	const videoParent = videoElem.parentNode;
	videoParent.style.position = 'relative';
	videoElem.style.width = '80%';

	const chatContainer = document.createElement('div');
	chatContainer.style['background-color'] = 'black';
	chatContainer.style.position = 'absolute';
	chatContainer.style.height = 'calc(100% - 150px)';
	chatContainer.style.width = '20%';
	chatContainer.style.left = '80%';
	chatContainer.style.top = '0px';
	chatContainer.style.padding = '10px';
	chatContainer.style['z-index'] = 3;
	chatContainer.style.display = 'flex';
	chatContainer.style['flex-direction'] = 'column';
	videoParent.appendChild(chatContainer);

	chatContainer.onclick = event => {
		event.stopPropagation();
	};

	chatContainer.onkeydown = event => {
		event.stopPropagation();
	};
	chatContainer.onkeyup = event => {
		event.stopPropagation();
	};

	const headerDiv = document.createElement('div');
	headerDiv.style.display = 'flex';
	headerDiv.style['flex-direction'] = 'row';
	chatContainer.appendChild(headerDiv);

	const partyCounter = document.createElement('div');
	partyCounter.style['background-color'] = '#DCDCDC';
	partyCounter.style['border-radius'] = '50%';
	partyCounter.style.width = '25px';
	partyCounter.style.height = '25px';
	partyCounter.style['text-align'] = 'center';

	const partyCounterAbbr = document.createElement('abbr');
	partyCounterAbbr.textContent = '1';
	partyCounterAbbr.title = 'You';
	partyCounterAbbr.style['text-decoration'] = 'none';
	partyCounter.appendChild(partyCounterAbbr);

	function updateTitle() {
		const nameList = ['You'];
		for (const key in party) {
			const {name} = party[key];
			nameList.push(name);
		}

		const titleText = nameList.join(', ');
		partyCounterAbbr.title = titleText;
	}

	function updatePartyCounter() {
		partyCounterAbbr.textContent = String(Object.keys(party).length + 1);
	}

	headerDiv.appendChild(partyCounter);

	const getHostIdButton = document.createElement('button');
	getHostIdButton.textContent = 'copy host id';
	getHostIdButton.style['width'] = '50px';
	getHostIdButton.addEventListener('click', () => {
		alert(peer.id);
	})

	headerDiv.appendChild(getHostIdButton);

	function sendAll(req) {
		for (const peerId in party) {
			const {connection} = party[peerId];
			connection.send(req);
		}
	}

	const messageContainer = document.createElement('div');
	messageContainer.style['flex-grow'] = 1;
	messageContainer.style.overflow = 'auto';
	chatContainer.appendChild(messageContainer);

	const messageInput = document.createElement('input');
	messageInput.type = 'text';
	messageInput.style.width = '100%';

	const commands = {
		'/help': {
			description: 'displays all possible commands and descriptions',
			run() {
				for (const key in commands) {
					systemMessage(`${key}: ${commands[key].description}`);
				}
			},
		},
		'/members': {
			description: 'displays all party members',
			run() {
				systemMessage('You');
				for (const key in party) {
					systemMessage(party[key].name);
				}
			},
		},
		'/mute': {
			description: 'toggle mute',
			run() {
				videoElem.muted = !videoElem.muted;
			}
		}
	};

	messageInput.addEventListener('keyup', event => {
		event.preventDefault();
		if (event.key === 'Enter') {
			const message = messageInput.value.trim();
			if (!message) {
				return;
			}

			if (message.startsWith('/')) {
				const splitMessage = message.split(' ');
				commands[splitMessage[0]].run(...splitMessage.slice(1));
			} else {
				addMessage(`You: ${message}`);
				sendAll({
					action: 'chat',
					message,
				});
			}

			messageInput.value = '';
		}
	});

	chatContainer.appendChild(messageInput);

	function addMessage(msg) {
		const wrapper = document.createElement('p');
		wrapper.style.color = 'white';
		const messageElem = document.createTextNode(msg);
		wrapper.appendChild(messageElem);
		messageContainer.appendChild(wrapper);
		messageContainer.scrollTo(0, messageContainer.scrollHeight);
	}

	function systemMessage(msg) {
		const wrapper = document.createElement('p');
		wrapper.style.color = 'gray';
		const messageElem = document.createTextNode(msg);
		wrapper.appendChild(messageElem);
		messageContainer.appendChild(wrapper);
		messageContainer.scrollTo(0, messageContainer.scrollHeight);
	}

	function errorMessage(msg) {
		const wrapper = document.createElement('p');
		wrapper.style.color = 'red';
		const messageElem = document.createTextNode(msg);
		wrapper.appendChild(messageElem);
		messageContainer.appendChild(wrapper);
		wrapper.scrollIntoView();
	}

	// let firstPlay = true;

	// videoElem.muted = true;

	const isDamp = {
		play: false,
		pause: false,
	};

	// Video event handlers
	videoElem.addEventListener('play', playHandler.bind(this));
	videoElem.addEventListener('pause', pauseHandler);

	function playHandler() {

		if (isDamp.play) {
			return;
		}

		// if (firstPlay) {
		// 	videoElem.muted = false;
		// 	firstPlay = false;
		// }

		setTimeout(() => {
			systemMessage(`You played the video at ${formatSeconds(videoElem.currentTime)}`);
			sendAll({
				action: 'play',
				time: videoElem.currentTime,
			});
		});
	}

	function pauseHandler() {
		if (isDamp.pause) {
			return;
		}

		systemMessage(`You paused the video at ${formatSeconds(videoElem.currentTime)}`);
		sendAll({
			action: 'pause',
			time: videoElem.currentTime,
		});
	}

	function formatSeconds(secs) {
		const roundedSecs = Math.round(secs);
		if (Number.isNaN(roundedSecs)) {
			return 'the party hasn\'t started yet';
		}

		const minutes = Math.floor(roundedSecs / 60);
		const remaining = roundedSecs % 60;
		const paddedSecs = String(remaining).padStart(2, '0');
		return `${minutes}:${paddedSecs}`;
	}

	function dampenedPause(time) {
		isDamp.pause = true;
		if (time) {
			setTimeout(() => {
				videoElem.currentTime = time;
			}, 0);
		}

		videoElem.pause();
		setTimeout(() => {
			isDamp.pause = false;
		}, 0);
	}

	function dampenedPlay(time) {
		isDamp.play = true;
		if (time) {
			setTimeout(() => {
				videoElem.currentTime = time;
			}, 0);
		}

		videoElem.play();
		setTimeout(() => {
			isDamp.play = false;
		}, 0);
	}

	const messageAlert = new Audio(chrome.runtime.getURL('message-alert.mp3'));
	const joinAlert = new Audio(chrome.runtime.getURL('join-alert.wav'));

	function setupConnection(conn) {
		conn.on('open', () => {
			conn.on('data', data => {
				const {action} = data;
				const actor = party[conn.peer]?.name;
				console.log(data);
				switch (action) {
					case 'greet': {
						const {name} = data;
						party[conn.peer] = {name, connection: conn};
						updatePartyCounter();
						updateTitle();
						systemMessage(`${name} has joined (${formatSeconds(data.time)}).`);
						conn.send({action: 'returnGreet', name: myName});
						joinAlert.play();
						break;
					}

					case 'requestConnections': {
						conn.send({action: 'respondConnections', connections: Object.keys(party), time: videoElem.currentTime, paused: videoElem.paused});
						break;
					}

					case 'respondConnections': {
						const {connections, time, paused} = data;
						for (let i = 0; i < connections.length; i++) {
							const peerId = connections[i];
							if (peer.id === peerId || conn.peer === peerId) {
								continue;
							}

							const proxyConn = peer.connect(peerId);
							setupConnection(proxyConn);
							proxyConn.on('open', () => {
								proxyConn.send({action: 'greet', name: myName});
							});
						}

						if (paused) {
							dampenedPause(time);
						} else {
							dampenedPlay(time);
						}

						break;
					}

					case 'returnGreet': {
						const {name} = data;
						party[conn.peer] = {name, connection: conn};
						updatePartyCounter();
						updateTitle();
						break;
					}

					case 'getUrl': {
						const url = window.location.href;
						conn.send({action: 'returnUrl', url});
						break;
					}

					case 'play': {
						dampenedPlay(data.time);
						systemMessage(`${actor} played the video at ${formatSeconds(data.time)}`);
						break;
					}

					case 'pause': {
						dampenedPause(data.time);
						systemMessage(`${actor} paused the video at ${formatSeconds(data.time)}`);
						break;
					}

					case 'chat': {
						const msg = `${actor}: ${data.message}`;
						addMessage(msg);
						messageAlert.play();
						break;
					}

					default:
						break;
				}
			});

			conn.on('close', () => {
				if (conn.peer in party) {
					const {name} = party[conn.peer];
					systemMessage(`${name} has left.`);
					delete party[conn.peer];
					updatePartyCounter();
					updateTitle();
				}
			});
			conn.on('error', err => {
				console.error(err);
				errorMessage('Something went wrong with the connection.');
			});
		});
		console.log('finished setting up');
	}

	peer.on('connection', conn => {
		setupConnection(conn);
	});

	peer.on('open', id => {
		systemMessage(id);
		if (hostId) {
			const conn = peer.connect(hostId);
			setupConnection(conn);
			conn.on('open', () => {
				conn.send({action: 'greet', name: myName});
				conn.send({action: 'requestConnections'});
			});
		}
	});

	peer.on('error', () => {
		errorMessage('Something went wrong. Try refreshing and retrying');
	});

	window.onbeforeunload = (() => {
		peer.destroy();
	});
}

function findUrl() {
	const url = document.querySelector('iframe').src;
	chrome.runtime.sendMessage({action: 'returnUrl', url});
}
