import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const HOST = '127.0.0.1';
const PORT = 3000;
const varsUrl = new URL('../worker/.dev.vars', import.meta.url);

function parseEnvFile(source) {
    return Object.fromEntries(
        String(source)
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#') && line.includes('='))
            .map(line => {
                const separator = line.indexOf('=');
                const key = line.slice(0, separator).trim();
                const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
                return [key, value];
            })
    );
}

if (!process.env.GEMINI_API_KEY) {
    const localVars = parseEnvFile(await readFile(varsUrl, 'utf8'));
    process.env.GEMINI_API_KEY = localVars.GEMINI_API_KEY || '';
    if (localVars.GEMINI_MODEL) process.env.GEMINI_MODEL = localVars.GEMINI_MODEL;
}

if (!process.env.GEMINI_API_KEY) {
    throw new Error('worker/.dev.vars içinde GEMINI_API_KEY bulunamadı.');
}

const { default: assistant } = await import('../api/assistant.js');

createServer(async (incoming, outgoing) => {
    try {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const request = new Request(`http://${incoming.headers.host || `${HOST}:${PORT}`}${incoming.url}`, {
            method: incoming.method,
            headers: incoming.headers,
            ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body })
        });
        const response = await assistant.fetch(request);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
        console.error('Local assistant failed:', String(error?.message || error));
        outgoing.writeHead(500, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        outgoing.end(JSON.stringify({ error: 'Yerel asistan işlemi tamamlanamadı.' }));
    }
}).listen(PORT, HOST, () => {
    console.log(`Denge AI hazır: http://${HOST}:${PORT}/api/assistant`);
});
