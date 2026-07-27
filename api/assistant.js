const MAX_BODY_BYTES = 18_000;
const MAX_MESSAGE_LENGTH = 600;
const MAX_CANDIDATES = 14;
const MODEL_ROUTES = Object.freeze({
    add: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    review: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    suggest: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']
});

const SHORT_REPLY_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        t: { type: 'string' }
    },
    required: ['t']
};

const ADD_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        a: { type: 'string', enum: ['add', 'clarify'] },
        m: { type: 'string', enum: ['b', 'l', 'd', 's'] },
        d: { type: 'string' },
        t: { type: 'string' },
        i: {
            type: 'array',
            maxItems: 5,
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    id: { type: 'string' },
                    n: { type: 'string' },
                    ty: { type: 'string', enum: ['f', 'd'] },
                    q: { type: 'number' },
                    u: {
                        type: 'string',
                        enum: ['g', 'ml', 'piece', 'slice', 'portion', 'glass', 'tea_glass', 'cup', 'tablespoon']
                    },
                    k: { type: 'number' },
                    p: { type: 'number' },
                    c: { type: 'number' },
                    f: { type: 'number' },
                    fi: { type: 'number' },
                    s: { type: 'number' },
                    na: { type: 'number' },
                    src: { type: 'string' },
                    cf: { type: 'number', minimum: 0, maximum: 1 }
                },
                required: ['id', 'n', 'ty', 'q', 'u', 'k', 'p', 'c', 'f', 'fi', 's', 'na', 'src', 'cf']
            }
        }
    },
    required: ['a', 'm', 'd', 't', 'i']
};

const CONTEXT_SCHEMA = `
C=[v,P,T,D,W]
P=[kg,boyCm,yas,hedefKg,hedefKodu(cm=orta acik,ca=yuksek acik,m=koru,b=artis)]
T=[dinlenmeKcal,antrenmanKcal,proteinHedef,karbHedef,yagHedef]
D satiri=[gunFarki,kcal,hedefKcal,protein,karb,yag,lif,seker,tuz,antrenman01,kayitSayisi]
W=[sonKilo,ort7,ort14,ort30,haftalikDegisimKg]
`.trim();

const REVIEW_INSTRUCTION = `
Türkçe beslenme değerlendirme motorusun. ${CONTEXT_SCHEMA}
Yalnız C verisini kullan. Son 7 günü değerlendir. Kayıt olmayan günü başarısız sayma; veri eksikse belirt.
Yanıt en fazla 3 çok kısa cümle olsun. İlerleme uygunsa tek cümle yeter.
Sorun varsa en fazla 2 uygulanabilir öneri ver. Selamlama, başlık, madde işareti, motivasyon klişesi ve tıbbi iddia kullanma.
`.trim();

const SUGGEST_INSTRUCTION = `
Türkçe, tek cümlelik öğün öneri motorusun. ${CONTEXT_SCHEMA}
Bugünün kalan enerji ve makro ihtiyacına göre tek bir basit öğün öner.
Miktarları kısa yaz. Selamlama, açıklama, alternatif liste ve tıbbi iddia kullanma.
`.trim();

const ADD_INSTRUCTION = `
Türkçe besin kayıt motorusun. Kullanıcı komutunu günlük kaydına dönüştür.
Adaylar A=[[id,ad,tur(f/d)]]. Uygun aday varsa id değerini aynen kullan, web arama yapma ve besin değerlerini 0 yaz.
Dış ürünün k,p,c,f,fi,s,na değerleri istenen TOPLAM miktara ait olmalı; na miligram, diğerleri gramdır.
Miktar yoksa 1 portion kullan. Öğün: b kahvaltı, l öğle, d akşam, s ara öğün. Belirtilmediyse saate en uygun öğünü seç.
Tarih d alanında YYYY-MM-DD olsun. Ekleme mümkünse a=add,t="" kullan. Kritik bilgi eksikse a=clarify ve tek kısa soru yaz.
Asla katalog id uydurma. En fazla 5 ürün çıkar. Selamlama ve açıklama yazma.
`.trim();

const ADD_SEARCH_INSTRUCTION = `
Uygun aday yoksa Google Search ile ürünü ara. Marka/restoran belirtilmişse resmi kaynağı, değilse güvenilir bir porsiyon ortalamasını kullan.
src alanına kullandığın gerçek kaynak adresini yaz.
`.trim();

const ADD_ESTIMATE_INSTRUCTION = `
Web araması kullanılamıyor. Uygun aday yoksa yaygın porsiyon ortalamasından muhafazakâr tahmin yap.
src="Gemini porsiyon tahmini" yaz; kaynak adresi uydurma.
`.trim();

function getCorsHeaders(request) {
    const origin = request.headers.get('Origin') || '';
    const requestHost = new URL(request.url).host;
    let allowedOrigin = '';
    try {
        const originUrl = new URL(origin);
        const local = /^(127\.0\.0\.1|localhost)$/.test(originUrl.hostname);
        if (originUrl.host === requestHost || local) allowedOrigin = origin;
    } catch {
        allowedOrigin = '';
    }
    return {
        ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    };
}

function json(request, data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...getCorsHeaders(request),
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function sanitizeCandidates(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_CANDIDATES).map(entry => [
        String(entry?.[0] || '').slice(0, 140),
        String(entry?.[1] || '').slice(0, 160),
        entry?.[2] === 'd' ? 'd' : 'f'
    ]).filter(entry => entry[0] && entry[1]);
}

function getGroundingSource(payload) {
    const chunks = payload?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    return String(chunks.find(chunk => chunk?.web?.uri)?.web?.uri || '').slice(0, 1000);
}

function getModelText(payload) {
    return (payload?.candidates?.[0]?.content?.parts || [])
        .map(part => part?.text || '')
        .join('')
        .trim();
}

function getUsage(payload) {
    const usage = payload?.usageMetadata || {};
    return {
        input: Math.max(0, Number(usage.promptTokenCount) || 0),
        output: Math.max(0, Number(usage.candidatesTokenCount) || 0),
        thought: Math.max(0, Number(usage.thoughtsTokenCount) || 0),
        total: Math.max(0, Number(usage.totalTokenCount) || 0)
    };
}

function normalizeAddResult(raw, candidates, fallbackDate, groundingSource) {
    const candidateMap = new Map(candidates.map(entry => [entry[0], entry]));
    const mealMap = { b: 'breakfast', l: 'lunch', d: 'dinner', s: 'snack' };
    const allowedUnits = new Set(['g', 'ml', 'piece', 'slice', 'portion', 'glass', 'tea_glass', 'cup', 'tablespoon']);
    const items = Array.isArray(raw?.i) ? raw.i.slice(0, 5) : [];

    return {
        action: raw?.a === 'add' ? 'add' : 'clarify',
        mealType: mealMap[raw?.m] || 'snack',
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.d || '')) ? raw.d : fallbackDate,
        text: String(raw?.t || '').trim().slice(0, 300),
        items: items.map(item => {
            const candidate = candidateMap.get(String(item?.id || ''));
            const isCatalog = Boolean(candidate);
            return {
                kind: isCatalog ? 'catalog' : 'external',
                id: isCatalog ? candidate[0] : '',
                name: isCatalog ? candidate[1] : String(item?.n || '').trim().slice(0, 160),
                type: (isCatalog ? candidate[2] : item?.ty) === 'd' ? 'drink' : 'food',
                amount: Math.min(100000, Math.max(0, finite(item?.q))),
                unit: allowedUnits.has(item?.u) ? item.u : ((isCatalog ? candidate[2] : item?.ty) === 'd' ? 'ml' : 'g'),
                nutrition: isCatalog ? null : {
                    kcal: Math.round(finite(item?.k)),
                    protein: finite(item?.p),
                    carb: finite(item?.c),
                    fat: finite(item?.f),
                    fiber: finite(item?.fi),
                    sugar: finite(item?.s),
                    sodium: finite(item?.na)
                },
                source: isCatalog ? 'Denge kataloğu' : String(item?.src || groundingSource || '').slice(0, 1000),
                confidence: Math.min(1, Math.max(0, finite(item?.cf)))
            };
        }).filter(item =>
            item.name
            && item.amount > 0
            && (item.kind === 'catalog' || item.nutrition?.kcal >= 0)
        )
    };
}

export function getModelRoute(mode, useSearch = false, {
    primaryModel = process.env.GEMINI_MODEL,
    searchModel = process.env.GEMINI_SEARCH_MODEL
} = {}) {
    const defaults = useSearch
        ? [searchModel, 'gemini-3.6-flash']
        : [primaryModel, ...(MODEL_ROUTES[mode] || MODEL_ROUTES.add)];
    return [...new Set(defaults.map(value => String(value || '').trim()).filter(Boolean))];
}

function isRetryableModelError(error) {
    const status = Number(error?.status) || 0;
    return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function callGemini({
    mode,
    message,
    today,
    hour,
    context,
    candidates,
    useSearch = false,
    model
}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        const error = new Error('Gemini anahtarı Vercel ortam değişkenlerine eklenmemiş.');
        error.status = 503;
        throw error;
    }

    const isAdd = mode === 'add';
    const systemInstruction = isAdd
        ? `${ADD_INSTRUCTION}\n${useSearch ? ADD_SEARCH_INSTRUCTION : ADD_ESTIMATE_INSTRUCTION}`
        : mode === 'suggest'
            ? SUGGEST_INSTRUCTION
            : REVIEW_INSTRUCTION;
    const prompt = isAdd
        ? JSON.stringify({
            D: today,
            S: Math.min(23, Math.max(0, Number(hour) || 0)),
            Q: message,
            A: candidates
        })
        : JSON.stringify({ C: context });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), useSearch ? 9_000 : 7_500);
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                signal: controller.signal,
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: systemInstruction }] },
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    ...(isAdd && useSearch ? { tools: [{ googleSearch: {} }] } : {}),
                    generationConfig: {
                        maxOutputTokens: isAdd ? 520 : 120,
                        thinkingConfig: { thinkingLevel: 'minimal' },
                        responseMimeType: 'application/json',
                        responseJsonSchema: isAdd ? ADD_SCHEMA : SHORT_REPLY_SCHEMA
                    }
                })
            }
        );

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload?.error?.message || 'Gemini isteği tamamlanamadı.');
            error.status = response.status;
            throw error;
        }
        const text = getModelText(payload);
        if (!text) throw new Error('Gemini boş yanıt verdi.');
        return {
            parsed: JSON.parse(text),
            usage: getUsage(payload),
            source: getGroundingSource(payload),
            model
        };
    } catch (error) {
        if (error?.name === 'AbortError') {
            const timeoutError = new Error(`${model} zaman aşımına uğradı.`);
            timeoutError.status = 408;
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function callGeminiRoute(options) {
    let lastError;
    for (const model of getModelRoute(options.mode, options.useSearch)) {
        try {
            return await callGemini({ ...options, model });
        } catch (error) {
            lastError = error;
            if (!isRetryableModelError(error)) throw error;
        }
    }
    throw lastError || new Error('Kullanılabilir Gemini modeli bulunamadı.');
}

export default {
    async fetch(request) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: getCorsHeaders(request) });
        }
        if (request.method !== 'POST') {
            return json(request, { error: 'Yalnızca POST desteklenir.' }, 405);
        }

        const contentLength = Number(request.headers.get('Content-Length') || 0);
        if (contentLength > MAX_BODY_BYTES) {
            return json(request, { error: 'İstek çok büyük.' }, 413);
        }

        let body;
        try {
            const raw = await request.text();
            if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
                return json(request, { error: 'İstek çok büyük.' }, 413);
            }
            body = JSON.parse(raw);
        } catch {
            return json(request, { error: 'Geçersiz istek.' }, 400);
        }

        const mode = ['add', 'review', 'suggest'].includes(body?.mode) ? body.mode : 'add';
        const message = String(body?.message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
        const today = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.today || ''))
            ? body.today
            : new Date().toISOString().slice(0, 10);
        const candidates = sanitizeCandidates(body?.candidates);
        const hour = Math.min(23, Math.max(0, Math.round(Number(body?.hour) || 0)));

        if (mode === 'add' && !message) {
            return json(request, { error: 'Komut boş olamaz.' }, 400);
        }
        if (mode !== 'add' && !Array.isArray(body?.context)) {
            return json(request, { error: 'Değerlendirme verisi eksik.' }, 400);
        }

        try {
            const useSearch = mode === 'add' && candidates.length === 0;
            let result;
            try {
                result = await callGeminiRoute({
                    mode,
                    message,
                    today,
                    hour,
                    context: body?.context,
                    candidates,
                    useSearch
                });
            } catch (error) {
                const searchFallbackStatuses = new Set([400, 408, 429, 500, 502, 503, 504]);
                if (!useSearch || !searchFallbackStatuses.has(Number(error?.status))) throw error;
                result = await callGeminiRoute({
                    mode,
                    message,
                    today,
                    hour,
                    context: body?.context,
                    candidates,
                    useSearch: false
                });
            }
            const data = mode === 'add'
                ? normalizeAddResult(result.parsed, candidates, today, result.source)
                : {
                    action: mode,
                    text: String(result.parsed?.t || '').trim().slice(0, 500),
                    items: []
                };
            return json(request, { ...data, usage: result.usage, model: result.model });
        } catch (error) {
            const status = Number(error?.status);
            if (status === 429) {
                return json(request, { error: 'Gemini kullanım sınırına ulaşıldı. Biraz sonra tekrar dene.' }, 429);
            }
            if (status === 401 || status === 403) {
                return json(request, { error: 'Gemini anahtarı veya proje yetkisi geçersiz.' }, 502);
            }
            if (status === 408) {
                return json(request, { error: 'Gemini modelleri şu anda yavaş yanıt veriyor. Tekrar dene.' }, 504);
            }
            console.error('Assistant request failed', {
                status: status || 0,
                message: String(error?.message || 'unknown').slice(0, 240)
            });
            return json(
                request,
                { error: status === 503 ? error.message : 'Asistan işlemi tamamlayamadı.' },
                status === 503 ? 503 : 502
            );
        }
    }
};
