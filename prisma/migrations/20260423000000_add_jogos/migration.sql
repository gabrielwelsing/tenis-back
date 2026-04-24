CREATE TABLE "jogos" (
    "id"              TEXT NOT NULL,
    "cidade"          TEXT NOT NULL,
    "classe"          TEXT NOT NULL,
    "dataInicio"      TEXT NOT NULL,
    "dataFim"         TEXT,
    "horarioInicio"   TEXT NOT NULL,
    "horarioFim"      TEXT NOT NULL,
    "local"           TEXT NOT NULL,
    "whatsapp"        TEXT NOT NULL,
    "publicadoEm"     BIGINT NOT NULL,
    "emailPublicador" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jogos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "jogos_cidade_dataInicio_idx" ON "jogos"("cidade", "dataInicio");
