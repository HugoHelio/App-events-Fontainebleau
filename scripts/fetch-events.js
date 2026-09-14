const fs = require('fs');
const https = require('https');

// Clé API Gemini depuis les variables d'environnement
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("Erreur: Clé API GEMINI_API_KEY introuvable.");
  process.exit(1);
}

// 1. Définition des sources (Exemple avec un flux RSS / JSON local ou externe)
// Vous pourrez ajouter ici les URLs des flux RSS de la Mairie de Fontainebleau, d'associations, etc.
const sampleRawData = `
Annonce - Mairie de Fontainebleau :
Grand Critérium Cycliste Enfants ce samedi 24 octobre de 10h à 12h au Parc du Château.
Gratuit pour les 6-12 ans. Inscriptions sur place avec le Vélo Club de Fontainebleau.

Atelier Peinture en Forêt - Samedi 24 octobre de 14h à 16h à la Faisanderie.
Organisé par les Ateliers d'Avon. Tarif : 8€ / enfant (8-15 ans).
`;

async function parseWithGemini(rawText) {
  const prompt = `
Tu es un extracteur de données strict. Analyse le texte suivant et extrait TOUS les événements sportifs, récréatifs et culturels pour enfants/familles autour de Fontainebleau.
Renvoie UNIQUEMENT un tableau JSON valide au format exact suivant, sans balises markdown ni texte autour :

[
  {
    "id": "ACT_AUTO_001",
    "title": "Titre explicite",
    "category": "Sport & Outdoor" | "Nature & Environnement" | "Culture & Ateliers",
    "ageMin": nombre,
    "ageMax": nombre,
    "city": "Nom de la ville",
    "locationName": "Lieu précis",
    "lat": latitude_approximative,
    "lng": longitude_approximative,
    "dateType": "event" | "recurring",
    "schedule": "Date ou jour récurrent",
    "price": "Tarif exact ou Gratuit",
    "organizer": "Nom organisateur",
    "description": "Courte description synthétique",
    "url": "URL ou lien supposé"
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
        try {
          const response = JSON.parse(body);
          const candidateText = response.candidates[0].content.parts[0].text;
          // Nettoyage des balises markdown si présentes
          const cleanJson = candidateText.replace(/```json/g, '').replace(/```/g, '').trim();
          resolve(JSON.parse(cleanJson));
        } catch (e) {
          reject("Erreur parsing Gemini : " + e.message + "\nRéponse brute : " + body);
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

    // Fusion avec le fichier data.json existant
    const existingDataPath = './data.json';
    let existingData = [];
    if (fs.existsSync(existingDataPath)) {
      existingData = JSON.parse(fs.readFileSync(existingDataPath, 'utf8'));
    }

    // Éviter les doublons par ID ou titre
    const updatedData = [...existingData];
    newEvents.forEach(newEvent => {
      if (!updatedData.some(e => e.title === newEvent.title)) {
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

