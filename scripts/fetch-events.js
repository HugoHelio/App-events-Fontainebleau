const fs = require('fs');
const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ Erreur: Clé API GEMINI_API_KEY introuvable dans les variables d'environnement.");
  process.exit(1);
}

async function searchEventsWithGemini() {
  const currentYear = new Date().getFullYear();

  const prompt = `
Effectue une recherche web récente et complète sur les évènements à venir à Fontainebleau et ses environs proches.
Nous sommes en ${currentYear}.

1. PÉRIMÈTRE GÉOGRAPHIQUE :
- Ville principale : Fontainebleau
- Rayon de 15 km autour de Fontainebleau
- Communes voisines : Avon, Bourron-Marlotte, Samois-sur-Seine, Thomery, Bois-le-Roi, Barbizon, Nemour, Moret-Loing-et-Orvanne.
- Evenements spécifiques au chateaux de Vaux-le-Vicomte, Blandy les tours et Fontainebleau.

2. TYPES D'ACTIVITÉS À CIBLER :
- Événements sportifs locaux (courses, trails, VTT, triathlons, compétitions d'escalade/bouldering, critériums).
- Activités Nature & Outdoor (sorties forêt, visites guidées, randonnées).
- Sorties culturelles & récréatives en famille (ateliers, stages, spectacles enfants, brocantes, fêtes de village).

3. SOURCES PRIORITAIRES :
- Agendas municipaux et offices de tourisme du Pays de Fontainebleau et des communes citées.
- Publications associatives, clubs sportifs locaux et plateformes de billetterie/inscription (HelloAsso, KMS, Klikego, etc.).
- Les magazines locaux (Le Bellifontain, etc.) et les réseaux sociaux des associations locales.
- Les grands événements sportifs et associatifs locaux (ex: La Malmontagne, L'Impérial Triathlon, La BelliBelleau / BelliBelloise, critériums cyclistes, trails, La Bellifontaine, etc.).

Analyse les résultats et extrait les événements sous forme de tableau JSON strict au format exact suivant :

[
  {
    "title": "Titre explicite de l'événement",
    "category": "Sport & Outdoor" | "Nature & Environnement" | "Culture & Ateliers",
    "ageMin": 6,
    "ageMax": 99,
    "city": "Fontainebleau",
    "locationName": "Lieu précis (ex: Parc du Château, Grand Parquet, Forêt Domaniale)",
    "lat": 48.4020,
    "lng": 2.7010,
    "dateType": "event",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "schedule": "Texte brut explicatif",
    "price": "Gratuit ou tarif",
    "organizer": "Nom de l'association ou organisateur",
    "description": "Courte description synthétique",
    "url": "URL source de l'événement"
  }
]
`;

  const apiUrl = new URL("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
  apiUrl.searchParams.append("key", GEMINI_API_KEY);

  // Activation de la recherche Google intégrée (Search Grounding)
  const requestData = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    tools: [
      { google_search: {} }
    ],
    generationConfig: {
      response_mime_type: "application/json",
      temperature: 0.2
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(`Erreur HTTP ${res.statusCode} API Gemini : ${body}`);
        }
        try {
          const response = JSON.parse(body);

          // Vérification de la présence de candidats
          const candidate = response.candidates && response.candidates[0];
          if (!candidate || !candidate.content || !candidate.content.parts) {
            return reject("Format de réponse invalide ou aucun candidat trouvé dans la réponse API.");
          }

          // Parcours de toutes les parts pour trouver celle contenant le texte JSON
          let rawJsonText = "";
          for (const part of candidate.content.parts) {
            if (part.text) {
              rawJsonText += part.text;
            }
          }

          if (!rawJsonText) {
            return reject("Aucun texte trouvé dans les parts de la réponse Gemini.");
          }

          // Nettoyage de sécurité des balises Markdown éventuelles
          const cleanJson = rawJsonText.replace(/```json/gi, '').replace(/```/g, '').trim();
          resolve(JSON.parse(cleanJson));
        } catch (e) {
          reject("Erreur parsing JSON : " + e.message + "\nRéponse brute : " + body);
        }
      });
    });

    req.on('error', reject);
    req.write(requestData);
    req.end();
  });
}

async function main() {
  console.log("🚀 Démarrage de la recherche automatique Gemini + Web Search...");
  try {
    const newEvents = await searchEventsWithGemini();
    console.log(`✅ ${newEvents.length} événements identifiés sur le web.`);

    const existingDataPath = './data.json';
    let existingData = [];
    if (fs.existsSync(existingDataPath)) {
      existingData = JSON.parse(fs.readFileSync(existingDataPath, 'utf8'));
    }

    const updatedData = [...existingData];

    newEvents.forEach(newEvent => {
      // Détection de doublons basée sur le titre (insensible à la casse)
      const index = updatedData.findIndex(e => e.title.trim().toLowerCase() === newEvent.title.trim().toLowerCase());

      const cleanEvent = {
        ...newEvent,
        startDate: newEvent.startDate || "",
        endDate: newEvent.endDate || newEvent.startDate || ""
      };

      if (index !== -1) {
        // Mise à jour en préservant l'ID d'origine
        const originalId = updatedData[index].id;
        updatedData[index] = { ...updatedData[index], ...cleanEvent, id: originalId };
      } else {
        // Création d'un nouvel identifiant
        cleanEvent.id = `ACT_${String(updatedData.length + 1).padStart(3, '0')}`;
        updatedData.push(cleanEvent);
      }
    });

    fs.writeFileSync(existingDataPath, JSON.stringify(updatedData, null, 2));
    console.log(`💾 Base data.json mise à jour avec succès ! Total : ${updatedData.length} activités.`);

  } catch (err) {
    console.error("❌ Erreur lors du scan :", err);
    process.exit(1);
  }
}

main();