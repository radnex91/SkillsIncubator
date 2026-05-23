# AI Chat Assistant pour SkillsIncubator

## Objectif
Intégrer un assistant de chat IA dans le modal de détail d'un skill, permettant à l'utilisateur de poser des questions contextuelles sur le skill en incubation.

## Architecture

```
Frontend (navigateur)        Serveur Node.js              Provider IA
┌─────────────────────┐     ┌──────────────────────┐    ┌──────────────┐
│ Chat UI             │────>│ POST /api/skills      │───>│ Ollama       │
│ dans le modal       │     │ /:id/chat             │    │ OpenAI       │
│ détail skill        │<────│                       │<───│ Anthropic    │
│                     │     │ + contexte skill      │    └──────────────┘
└─────────────────────┘     └──────────────────────┘
```

## Endpoint serveur : `POST /api/skills/:id/chat`

### Requête
```json
{
  "messages": [
    {"role": "user", "content": "Quels jalons me conseilles-tu pour progresser ?"}
  ]
}
```

Le serveur enrichit la requête avec le contexte complet du skill avant de l'envoyer au provider IA.

### Réponse
```json
{
  "content": "Voici quelques jalons recommandés pour ton skill..."
}
```

### Contexte injecté (prompt système)
Le serveur construit automatiquement un message système contenant :
- Nom, description, statut, progression
- Catégorie et couleur
- Liste des jalons (titres + état done/pending)
- Derniers logs du journal
- Notes personnelles
- URL du dépôt

Exemple de prompt système généré :
```
Tu es un assistant expert en incubation de compétences.
Tu aides l'utilisateur à développer son skill "React" en mode "incubating" (progression: 30%).

Contexte du skill :
- Description : Maîtrise de React pour le développement frontend
- Catégorie : Frontend
- Jalons : [x] Installer React, [ ] Créer premier composant, [ ] Apprendre les hooks
- Notes : Se concentrer sur les hooks avant Redux
- Logs récents : A commencé le tuto officiel

Sois concis, pratique, et orienté action. Réponds en français.
```

## Provider IA flexible

Configured via variable d'environnement `AI_PROVIDER` :

| Provider   | Valeur `AI_PROVIDER` | Configuration requise             |
|------------|----------------------|-----------------------------------|
| Ollama     | `ollama` (défaut)    | Ollama installé + modèle (ex: `llama3`, `mistral`) |
| OpenAI     | `openai`             | `OPENAI_API_KEY`                  |
| Anthropic  | `anthropic`          | `ANTHROPIC_API_KEY`               |

Variables d'env supplémentaires :
- `AI_MODEL` : modèle à utiliser (défaut : `llama3` pour Ollama, `gpt-4o-mini` pour OpenAI, `claude-3-haiku-20240307` pour Anthropic)
- `AI_ENDPOINT` : URL de l'API (utile pour Ollama, défaut : `http://localhost:11434`)

## Chat UI (frontend)

### Emplacement
Intégré dans le modal de détail du skill (`#detailContent`), après la section journal et avant les boutons d'action.

### Composants
- **Zone de messages** : bulles scrollables, utilisateur aligné à droite, IA alignée à gauche
- **Champ de saisie** : input texte + bouton Envoyer (ou Entrée pour envoyer)
- **Indicateur de frappe** : "Assistant réfléchit..." avec animation pendant l'appel API
- **Bouton d'initialisation** : "Démarrer une conversation IA" si aucun message n'a encore été envoyé

### États
- **Idle** : aucun message, bouton "Démarrer une conversation IA"
- **En cours** : indicateur de frappe + messages précédents visibles
- **Réponse reçue** : bulle IA affichée
- **Erreur** : message d'erreur dans une bulle spéciale + option de réessayer

### Gestion des messages
- Les messages sont stockés en mémoire JavaScript (pas de persistance BDD)
- Réinitialisés à chaque ouverture du modal
- Pas de limite stricte

## Fichiers modifiés

### server.js
- Ajout de la config AI provider (lecture des variables d'env)
- Ajout de la fonction `buildSkillContext(skillId)` pour récupérer le contexte
- Ajout de la fonction `callAI(messages, systemPrompt)` pour appeler le provider
- Ajout de la route `POST /api/skills/:id/chat`

### public/index.html
- Ajout du HTML pour l'interface de chat dans `#detailContent`
- Ajout des styles CSS pour le chat (bulles, input, animations)
- Ajout des fonctions JS : `sendChatMessage()`, `renderChat()`, `addChatBubble()`

## Packages
- Aucun package requis pour Ollama (utilisation de `fetch` natif ou `http` module)
- `openai` (optionnel, si switch vers OpenAI)
- `@anthropic-ai/sdk` (optionnel, si switch vers Anthropic)

## Installation pour l'utilisateur

Par défaut (Ollama) :
```bash
# Installer Ollama : https://ollama.com
ollama pull llama3
# Lancer le serveur (déjà fait automatiquement si le service tourne)
AI_PROVIDER=ollama AI_MODEL=llama3 node server.js
```

Avec OpenAI :
```bash
OPENAI_API_KEY=sk-... AI_PROVIDER=openai node server.js
```

## Notes supplémentaires
- La fonction `buildSkillContext` récupère les infos du skill via les fonctions `q()` existantes
- L'historique de chat n'est pas persisté en BDD pour rester simple (perdu au refresh navigateur)
- Les appels API sont gérés avec un timeout de 30s pour éviter les blocages
