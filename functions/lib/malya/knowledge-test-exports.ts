// Réexports pour les tests : une seule source de vérité (knowledge.ts / corpus.ts).
export { KNOWLEDGE, SEED, coverage, retrieve, reviewReport, validateEntry, isOutdated } from "./knowledge.ts";
export { CORPUS as CORPUS_FOR_TEST } from "./corpus.ts";
