# Tribu

Organisation familiale en PWA : enfants, rendez-vous, tâches, santé, tailles et courses partagées, synchronisés en temps réel entre les membres de la famille.

by @jeremstyke

## Stack
- HTML / CSS / JavaScript vanilla
- Supabase (auth, base Postgres avec RLS, temps réel), projet `tribu` hébergé à Paris (eu-west-3)
- Hébergement : GitHub Pages

## Déploiement
1. Créer le repo `tribu` sur GitHub et y pousser ces fichiers à la racine.
2. Settings > Pages > Deploy from a branch > `main` / root.
3. L'app est en ligne sur https://jeremstyke.github.io/tribu/

## Configuration Supabase (une seule fois)
Authentication > URL Configuration :
- Site URL : https://jeremstyke.github.io/tribu/
- Redirect URLs : https://jeremstyke.github.io/tribu/**
