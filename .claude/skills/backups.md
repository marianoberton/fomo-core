# Nexus Core — Postgres Backups

## Script
`/root/backup-nexus.sh` on VPS (`hostinger-fomo`).

- pg_dump en formato custom (`-F c`) desde el container postgres
- Destino: `/root/backups/nexus_core_<YYYYMMDD_HHMM>.dump`
- Retención: 28 días (archivos más viejos se borran automáticamente)
- Log: `/root/backups/backup.log`

## Cron
Corre cada **domingo a las 3 AM UTC**:
```
0 3 * * 0 /root/backup-nexus.sh
```

## Backup manual
```bash
ssh hostinger-fomo "/root/backup-nexus.sh && tail -5 /root/backups/backup.log"
```

## Ver backups disponibles
```bash
ssh hostinger-fomo "ls -lh /root/backups/nexus_core_*.dump"
```

## Ver log
```bash
ssh hostinger-fomo "tail -30 /root/backups/backup.log"
```

## Restaurar sobre DB actual
```bash
# 1. Copiar el dump al container
ssh hostinger-fomo "docker cp /root/backups/<dump_file>.dump compose-generate-multi-byte-system-fqoeno-postgres-1:/tmp/restore.dump"

# 2. Restaurar (DROP + recreate objetos — usa --clean para overwrite)
ssh hostinger-fomo "docker exec compose-generate-multi-byte-system-fqoeno-postgres-1 \
  pg_restore -U nexus -d nexus_core --clean --if-exists /tmp/restore.dump"

# 3. Limpiar
ssh hostinger-fomo "docker exec compose-generate-multi-byte-system-fqoeno-postgres-1 rm /tmp/restore.dump"
```

> El dump del 20 abril 2026 (pre-schema fix) está en `/root/nexus_core_pre_schema_fix.dump` (613K) — referencia histórica, no entra en la rotación automática.
