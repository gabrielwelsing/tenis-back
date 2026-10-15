-- Exclusão de ligas (rankings) pelo admin: soft delete, recuperável zerando a coluna.
ALTER TABLE ligas ADD COLUMN IF NOT EXISTS excluida_em TIMESTAMPTZ;
