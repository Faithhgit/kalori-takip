export function normalizeSearchText(value) {
    return String(value || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function getWords(value) {
    return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

function editDistance(left, right) {
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;

    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    const current = new Array(right.length + 1);

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        current[0] = leftIndex;
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
            current[rightIndex] = Math.min(
                current[rightIndex - 1] + 1,
                previous[rightIndex] + 1,
                previous[rightIndex - 1] + substitutionCost
            );
        }
        for (let index = 0; index < current.length; index += 1) {
            previous[index] = current[index];
        }
    }

    return previous[right.length];
}

function scoreToken(queryToken, candidateText, candidateWords) {
    if (candidateText === queryToken) return 0;

    const exactWordIndex = candidateWords.indexOf(queryToken);
    if (exactWordIndex !== -1) return 4 + exactWordIndex;

    if (candidateText.startsWith(queryToken)) return 10;

    const prefixIndex = candidateWords.findIndex(word => word.startsWith(queryToken));
    if (prefixIndex !== -1) return 18 + prefixIndex;

    if (queryToken.length >= 3) {
        let bestTypoScore = Number.POSITIVE_INFINITY;
        candidateWords.forEach((word, index) => {
            const comparable = word.slice(0, Math.max(queryToken.length, Math.min(word.length, queryToken.length + 1)));
            const distance = editDistance(queryToken, comparable);
            const allowedDistance = queryToken.length >= 6 ? 2 : 1;
            if (distance <= allowedDistance) {
                bestTypoScore = Math.min(bestTypoScore, 30 + (distance * 4) + index);
            }
        });
        if (Number.isFinite(bestTypoScore)) return bestTypoScore;
    }

    const containsIndex = candidateText.indexOf(queryToken);
    if (containsIndex !== -1) return 60 + containsIndex;

    return Number.POSITIVE_INFINITY;
}

export function getSearchScore(item, searchTerm) {
    const query = normalizeSearchText(searchTerm);
    if (!query) return 0;

    const queryWords = getWords(query);
    const candidates = [item?.name, ...(item?.search_aliases || [])]
        .map(normalizeSearchText)
        .filter(Boolean);

    let bestScore = Number.POSITIVE_INFINITY;
    candidates.forEach((candidate, candidateIndex) => {
        const candidateWords = getWords(candidate);
        let candidateScore = candidateIndex * 3;

        for (const queryWord of queryWords) {
            const tokenScore = scoreToken(queryWord, candidate, candidateWords);
            if (!Number.isFinite(tokenScore)) {
                candidateScore = Number.POSITIVE_INFINITY;
                break;
            }
            candidateScore += tokenScore;
        }

        if (candidate === query) candidateScore = Math.min(candidateScore, candidateIndex);
        bestScore = Math.min(bestScore, candidateScore);
    });

    return bestScore;
}

export function itemMatchesSearch(item, searchTerm) {
    return Number.isFinite(getSearchScore(item, searchTerm));
}

export function rankSearchItems(items, searchTerm, limit = Number.POSITIVE_INFINITY) {
    const query = normalizeSearchText(searchTerm);
    if (!query) return items.slice(0, limit);

    const ranked = items
        .map((item, sourceIndex) => ({
            item,
            sourceIndex,
            score: getSearchScore(item, query)
        }))
        .filter(result => Number.isFinite(result.score))
        .sort((left, right) =>
            left.score - right.score
            || left.item.name.localeCompare(right.item.name, 'tr')
            || left.sourceIndex - right.sourceIndex
        );
    const bestScore = ranked[0]?.score;
    const relevanceCutoff = Number.isFinite(bestScore) ? bestScore + 14 : Number.POSITIVE_INFINITY;

    return ranked
        .filter(result => result.score <= relevanceCutoff)
        .slice(0, limit)
        .map(result => result.item);
}
