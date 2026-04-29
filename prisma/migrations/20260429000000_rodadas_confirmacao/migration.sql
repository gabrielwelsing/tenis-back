-- ============================================================
-- RODADAS — Partidas agrupadas por rodada criada pelo admin
-- Confirmação dupla nas partidas
-- ============================================================

CREATE TABLE IF NOT EXISTS "rodadas" (
  "id"           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "temporada_id" UUID        NOT NULL REFERENCES "temporadas"("id") ON DELETE CASCADE,
  "numero"       INTEGER     NOT NULL,
  "ativa"        BOOLEAN     NOT NULL DEFAULT TRUE,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_rodadas_temporada" ON "rodadas"("temporada_id");

-- Adiciona colunas de confirmação e rodada às partidas existentes
ALTER TABLE "partidas" ADD COLUMN IF NOT EXISTS "rodada_id"    UUID    REFERENCES "rodadas"("id");
ALTER TABLE "partidas" ADD COLUMN IF NOT EXISTS "confirmado_a" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "partidas" ADD COLUMN IF NOT EXISTS "confirmado_b" BOOLEAN NOT NULL DEFAULT FALSE;
