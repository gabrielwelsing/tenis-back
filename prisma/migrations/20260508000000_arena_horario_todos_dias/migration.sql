-- Arena Tênis: todos os dias (0=Dom a 6=Sáb), 07h às 21h
UPDATE quadra_disponibilidade
SET    dias_semana = ARRAY[0,1,2,3,4,5,6],
       hora_inicio = 7,
       hora_fim    = 21
WHERE  quadra_id IN (
  SELECT q.id
  FROM   quadras q
  JOIN   locais  l ON q.local_id = l.id
  WHERE  l.nome LIKE '%Arena%'
);
