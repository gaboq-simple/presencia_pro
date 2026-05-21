-- Migración 032 — Eliminar función SQL get_available_slots() huérfana
-- La lógica de disponibilidad vive en TypeScript (packages/engine/src/bot/lifestyle/scheduling.ts).
-- La función SQL nunca fue llamada desde el código y puede generar confusión de mantenimiento.
DROP FUNCTION IF EXISTS get_available_slots(UUID, DATE, INT);
