import { get } from "idb-keyval";
import { Candidate, Question, Word } from "../types";
import { shuffle } from "../utils";

const CHARS_CONTAIN_SCORE = 1 << 2;
const CHARS_NOT_CONTAIN_SCORE = -1;
const TRAN_EQUALS_BASE_SCORE = 1 << 16;
const TRANS_CHARS_COMMON_FACTOR = 1;
const WORD_COMMON_FACTOR = 1 << 16;
const WORD_CONTAIN_SCORE = 1 << 20;
const FUZZ_SCORE_BASE = 1 << 18;

function getTrans(word: Word): { cn: string, freq: number }[] {
    let rsMap = new Map<string, { cn: string, freq: number }>();
    word.trans.forEach(item => {
        let target = rsMap.get(item.cn);
        if (target) {
            target.freq += item.frequency || 0;
            rsMap.set(item.cn, target);
        } else {
            rsMap.set(item.cn, { cn: item.cn, freq: item.frequency || 0 });
        }
    })
    return Array.from(rsMap.values());
}

function calCommon(str1: string, str2: string): number {
    str1 = str1.toLowerCase();
    str2 = str2.toLowerCase();
    let rs = 0;
    let set1 = new Set(str1.split(''));
    let set2 = new Set(str2.split(''));
    for (let char of set1) {
        if (set2.has(char)) {
            rs += CHARS_CONTAIN_SCORE;
        } else {
            rs += CHARS_NOT_CONTAIN_SCORE;
        }
    }
    for (let char of set2) {
        if (set1.has(char)) {
            rs += CHARS_CONTAIN_SCORE;
        } else {
            rs += CHARS_NOT_CONTAIN_SCORE;
        }
    }
    return rs;
}

function calSimilarity(word1: Word, word2: Word): number {
    if (word2.trans.length < word1.trans.length) {
        [word1, word2] = [word2, word1];
    }
    let word1Trans = getTrans(word1);
    let word2Trans = getTrans(word2);
    let word2TransMap = new Map(word2Trans.map(item => [item.cn, item]));

    let similarity = 0;
    word1Trans.forEach((item) => {
        let item2 = word2TransMap.get(item.cn);
        if (item2) {
            const freq1 = item.freq;
            const freq2 = item2.freq;
            similarity += (freq1 * freq2) * TRAN_EQUALS_BASE_SCORE;
        }
    })

    similarity += calCommon(word1Trans.map(item => item.cn).join(''), word2Trans.map((item) => item.cn).join('')) * TRANS_CHARS_COMMON_FACTOR;
    similarity += calCommon(word1.word, word2.word) * WORD_COMMON_FACTOR;
    if (
        word1.word.includes(word2.word) ||
        word2.word.includes(word1.word)
    ) {
        similarity += WORD_CONTAIN_SCORE;
    }
    if (
        word1.relWords.rels.findIndex(rel => rel.words.findIndex(word => word.c === word2.word) !== -1) !== -1 ||
        word2.relWords.rels.findIndex(rel => rel.words.findIndex(word => word.c === word1.word) !== -1) !== -1
    ) {
        similarity += WORD_CONTAIN_SCORE;
        // console.log('relWords', word1.word, word2.word)
    }
    return similarity + Math.pow(Math.random(), 2) * FUZZ_SCORE_BASE;
}

/** 干扰项选取(不含正确项): 从 list 中按相似度打分选最像的 maxCount-1 个 */
function pickDistractors(word: Word, list: Word[], maxCount: number): { word: Word, similarity: number }[] {
    // 大词库(ECDICT 84 万词)每次切词全量打分卡顿数秒:先按词长 ±2 过滤 + 均匀抽样降采样。
    // fuzz 分本身带随机性,抽样后候选仍是"像"的词,四选一体验一致
    let pool = list
    if (list.length > 1000) {
        const len = word.word.length
        const lenFiltered = list.filter(item => Math.abs(item.word.length - len) <= 2)
        if (lenFiltered.length >= 300) {
            // 均匀间隔抽样到 ~500 个(不打乱原数组,分布均匀)
            const step = lenFiltered.length / 500
            pool = lenFiltered.filter((_, i) => Math.floor(i / step) !== Math.floor((i + 1) / step))
        }
        // lenFiltered < 300 时保持全量,避免小候选池里干扰项质量下降
    }

    let similarityList: { word: Word, similarity: number }[] = []
    for (let i = 0; i < pool.length; i++) {
        const item = pool[i]

        const wordStr = word.word.toLowerCase()
        const itemStr = item.word.toLowerCase()
        if (wordStr === itemStr) continue

        if (word.trans.map(t => t.cn).join('') === item.trans.map(t => t.cn).join('')) continue

        const similarity = calSimilarity(word, item)
        similarityList.push({ word: item, similarity })
    }
    similarityList.sort((a, b) => a.similarity - b.similarity)

    return similarityList.slice(-(Math.min(maxCount - 1, similarityList.length)))
}

export function buildQuestion(word: Word, list: Word[], maxCount: number = 4): Question {
    let candidates = pickDistractors(word, list, maxCount).map(v => ({ word: v.word, similarity: v.similarity }))
    candidates.push({ word: word, similarity: Infinity })
    candidates = shuffle(candidates)
    // console.log(candidates)
    const correctIndex = candidates.findIndex(v => v.word === word)
    return {
        candidates,
        correctIndex,
    }
}
