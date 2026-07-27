const isStaticLocalPreview =
    ['127.0.0.1', 'localhost'].includes(window.location.hostname)
    && window.location.port === '4173';

export const AI_ENDPOINT = isStaticLocalPreview
    ? 'http://127.0.0.1:3000/api/assistant'
    : '/api/assistant';
