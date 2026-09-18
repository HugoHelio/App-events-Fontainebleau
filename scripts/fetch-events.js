const fs = require('fs');
const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ Erreur: Clé API GEMINI_API_KEY introuvable.");
  process.exit(1);
}

async function searchEventsWithGemini() {
  const currentYear = new Date().getFullYear();

  const prompt = `
Recherche les événements à venir à Fontainebleau et aux alentours (Avon, Samois, Nemours, Barbizon, Moret, etc.) pour l'année ${currentYear}.
Cible : sports, nature, activités en famille, culture, fêtes locales.

Renvoie UNIQUEMENT un tableau JSON strict (sans texte explicatif avant ou après) respectant exactement ce format :
[
  {
    "title": "Titre de l'événement",
    "category": "Sport & Outdoor",
    "ageMin": 0,
    "ageMax": 99,
    "city": "Fontainebleau",
    "locationName": "Lieu précis",
    "lat": 48.4020,
    "lng": 2.7010,
    "dateType": "event",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "schedule": "Horaire ou détails",
    "price": "Tarif ou Gratuit",
    "organizer": "Organisateur",
    "description": "Courte description",
    "url": "URL source"
  }
]
`;

  const apiUrl = new URL("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
  apiUrl.searchParams.append("key", GEMINI_API_KEY);

  const requestData = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    tools: [
      { google_search: {} }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192
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
          return reject(`Erreur HTTP ${res.statusCode} : ${body}`);
        }
        try {
          const response = JSON.parse(body);

          const candidate = response.candidates && response.candidates[0];
          if (!candidate) {
            console.error("Réponse brute API sans candidat :", JSON.stringify(response, null, 2));
            return reject("Aucun candidat retourné dans la réponse API.");
          }

          let rawText = "";
          if (candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
              if (part.text) rawText += part.text;
            }
          }

          if (!rawText) {
            return reject(`Aucun texte généré. FinishReason: ${candidate.finishReason}`);
          }

          // Extraction stricte du bloc JSON [...] dans le texte retourné
          const jsonMatch = rawText.match(/\[[\s\S]*\]/);
          if (!jsonMatch) {
            return reject("Impossible de localiser un tableau JSON dans la réponse : " + rawText);
          }

          const cleanJson = jsonMatch[0].trim();
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
  console.log("🚀 Démarrage de la recherche automatique Gemini 3.6 + Web Search...");
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
      const index = updatedData.findIndex(e => e.title && e.title.trim().toLowerCase() === newEvent.title.trim().toLowerCase());

      const cleanEvent = {
        ...newEvent,
        startDate: newEvent.startDate || "",
        endDate: newEvent.endDate || newEvent.startDate || ""
      };

      if (index !== -1) {
        const originalId = updatedData[index].id;
        updatedData[index] = { ...updatedData[index], ...cleanEvent, id: originalId };
      } else {
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