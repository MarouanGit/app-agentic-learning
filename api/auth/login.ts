export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }

  // TODO: Vérifier dans PostgreSQL (Neon)
  // Pour maintenant : authentification dummy
  const token = Buffer.from(`${email}:${password}`).toString('base64');

  res.status(200).json({
    success: true,
    token,
    user: { email, name: email.split('@')[0] }
  });
}
