const fs = require('fs');
const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ Erreur: Clé API GEMINI_API_KEY introuvable dans les variables d'environnement.");
  process.exit(1);
}

// Exemple de texte brut à parser (remplaçable par un scraping Web/RSS ultérieurement)
const sampleRawData = `
Annonce - Mairie de Fontainebleau :
Grand Critérium Cycliste Enfants ce samedi 24 octobre de 10h à 12h au Parc du Château.
Gratuit pour les 6-12 ans. Inscriptions sur place avec le Vélo Club de Fontainebleau.

Atelier Peinture en Forêt - Samedi 24 octobre de 14h à 16h à la Faisanderie.
Organisé par les Ateliers d'Avon. Tarif : 8€ / enfant (8-15 ans).
`;

async function parseWithGemini(rawText) {
  const currentYear = new Date().getFullYear();

  const prompt = `
Tu es un extracteur de données strict. Analyse le texte suivant et extrait TOUS les événements sportifs, récréatifs et culturels pour enfants/familles autour de Fontainebleau.
Nous sommes en ${currentYear}.

Renvoie UNIQUEMENT un tableau JSON valide au format exact suivant, sans aucun texte ni balises markdown autour :

[
  {
    "id": "ACT_AUTO_001",
    "title": "Titre explicite",
    "category": "Sport & Outdoor" | "Nature & Environnement" | "Culture & Ateliers",
    "ageMin": 6,
    "ageMax": 12,
    "city": "Fontainebleau",
    "locationName": "Parc du Château",
    "lat": 48.4020,
    "lng": 2.7010,
    "dateType": "event" ou "recurring",
    "startDate": "YYYY-MM-DD" (Obligatoire si dateType=event. Si récurrent, laisser vide ""),
    "endDate": "YYYY-MM-DD" (Optionnel si stage sur plusieurs jours),
    "schedule": "Texte brut explicatif (ex: Samedi 24 octobre de 10h à 12h ou Tous les mercredis)",
    "price": "Gratuit" ou "8€",
    "organizer": "Nom organisateur",
    "description": "Courte description synthétique",
    "url": "https://www.fontainebleau.fr"
  }
]

Texte brut :
${rawText}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`;
  const requestData = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }]
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
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
          return reject(`Erreur HTTP ${res.statusCode} de l'API Gemini : ${body}`);
        }
        try {
          const response = JSON.parse(body);
          let rawJsonText = response.candidates[0].content.parts[0].text;
          
          rawJsonText = rawJsonText.replace(/```json/gi, '').replace(/```/g, '').trim();
          resolve(JSON.parse(rawJsonText));
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
  console.log("🚀 Démarrage du check automatique Gemini...");
  try {
    const newEvents = await parseWithGemini(sampleRawData);
    console.log(`✅ ${newEvents.length} événements extraits par Gemini.`);

    const existingDataPath = './data.json';
    let existingData = [];
    if (fs.existsSync(existingDataPath)) {
      existingData = JSON.parse(fs.readFileSync(existingDataPath, 'utf8'));
    }

    // Fusion intelligente : mise à jour des éléments existants ou ajout
    const updatedData = [...existingData];
    newEvents.forEach(newEvent => {
      const index = updatedData.findIndex(e => e.title === newEvent.title);
      if (index !== -1) {
        updatedData[index] = { ...updatedData[index], ...newEvent };
      } else {
        updatedData.push(newEvent);
      }
    });

    fs.writeFileSync(existingDataPath, JSON.stringify(updatedData, null, 2));
    console.log("💾 Fichier data.json mis à jour avec succès !");

  } catch (err) {
    console.error("❌ Erreur lors de l'exécution :", err);
    process.exit(1);
  }
}

main();