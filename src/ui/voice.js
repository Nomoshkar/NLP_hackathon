/**
 * Voice input via the Web Speech API (SpeechRecognition).
 *
 * This is a browser-native capability, not a cloud service: Chrome, Edge and
 * Safari implement it locally or through the browser vendor's own speech
 * service. Where it is unavailable the mic button is disabled and the UI falls
 * back to typed input — no AI API key is ever involved.
 */

const SpeechRecognitionCtor = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

export function isVoiceSupported() {
  return Boolean(SpeechRecognitionCtor);
}

/**
 * @param {{onPartial?: (text:string)=>void, onFinal: (text:string)=>void, onStateChange?: (state:string)=>void, onError?: (message:string)=>void}} handlers
 */
export function createVoiceInput(handlers = {}) {
  if (!isVoiceSupported()) {
    return {
      supported: false,
      start() {},
      stop() {},
      toggle() {},
      get listening() { return false; },
    };
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let listening = false;
  let finalText = '';

  const setState = (state) => handlers.onStateChange?.(state);

  recognition.onstart = () => {
    listening = true;
    finalText = '';
    setState('listening');
  };

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result[0]?.transcript || '';
      if (result.isFinal) finalText += transcript;
      else interim += transcript;
    }
    handlers.onPartial?.((finalText + interim).trim());
  };

  recognition.onerror = (event) => {
    listening = false;
    setState('idle');
    const messages = {
      'not-allowed': 'Microphone permission was blocked. Allow it in your browser settings to use voice input.',
      'service-not-allowed': 'Speech recognition is unavailable in this browser.',
      'no-speech': 'I did not catch that — try again.',
      'audio-capture': 'No microphone was found.',
      network: 'Speech recognition needs a network connection in this browser.',
      aborted: '',
    };
    const message = messages[event.error] ?? `Voice input error: ${event.error}`;
    if (message) handlers.onError?.(message);
  };

  recognition.onend = () => {
    listening = false;
    setState('idle');
    const text = finalText.trim();
    finalText = '';
    if (text) handlers.onFinal?.(text);
  };

  function start() {
    if (listening) return;
    try {
      recognition.start();
    } catch (err) {
      // start() throws if called while already active; safe to ignore.
      console.warn('speech recognition start failed', err);
    }
  }

  function stop() {
    if (!listening) return;
    try {
      recognition.stop();
    } catch (err) {
      console.warn('speech recognition stop failed', err);
    }
  }

  return {
    supported: true,
    start,
    stop,
    toggle() {
      if (listening) stop();
      else start();
    },
    get listening() {
      return listening;
    },
  };
}
