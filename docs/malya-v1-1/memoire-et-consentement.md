# Mémoire progressive et consentement

## Niveau 1 — mémoire locale (implémentée)
- Facultative, activée par une case à cocher explicite, désactivée par défaut.
- Stockage dans le navigateur uniquement (`localStorage`, clé `malya.conv.v2`) ; **rien n'est conservé côté serveur**.
- Expiration **30 jours** (`MEMORY_TTL_DAYS`), 40 tours par conversation, **5 conversations séparées** au plus ; nouvelle conversation, bascule et suppression.
- Retrait du consentement ou « Effacer » : suppression immédiate des conversations et des champs du Project Builder.
- Le serveur reçoit l'historique de la conversation active uniquement pour répondre, sans le stocker ; il est traité comme non fiable (injections détectées).
- Testé (unitaire + navigateur) : sans consentement rien n'est stocké ; reprise après rechargement ; expiration ; retrait ; effacement ; un autre navigateur ne voit rien.

## Niveau 2 — mémoire sur serveur (NON implémentée, volontairement désactivée)
`serverMemory.ts` garantit qu'aucun stockage durable n'existe : `serverMemoryStatus().available === false`, aucune table de conversation (test sur le schéma), l'arrêt d'urgence la couvre. Prérequis avant toute activation :

1. Comptes et authentification sécurisée, sessions (réutiliser le patron de l'espace membre existant, `functions/lib/member.ts`, plutôt qu'un second système).
2. Isolation par utilisateur appliquée côté serveur, avec tests d'accès croisé.
3. Mémoire **par projet** ; consultation, correction, export, suppression, retrait du consentement.
4. Politique de conservation et durées (proposition : 12 mois d'inactivité, suppression à la demande sous 30 jours).
5. Chiffrement des champs sensibles, sauvegardes et restauration testées.
6. Audit des accès (qui, quand, quoi, sans contenu inutile).
7. Politique RGPD documentée : finalité (reprise d'un projet), base légale (consentement), registre des traitements, sous-traitants (Cloudflare ; Anthropic si le contenu y transite — à mentionner), information des personnes, DPO/contact. Pas de donnée sensible sans nécessité.

Tant que ces points ne sont pas réalisés **et testés**, la mémoire serveur ne doit pas être activée.

## Données transmises à Anthropic
Lorsque le mode IA est actif, le message de l'utilisateur, l'historique récent de la conversation et les passages documentaires sont envoyés à l'API Anthropic pour produire la réponse. L'information « MALYA est une IA » figure dans l'interface ; la mention de ce transfert doit être ajoutée à la politique de confidentialité **avant** l'activation publique (à valider avec WEBLACK).
