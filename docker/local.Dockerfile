FROM viberacing:local-web

USER root
RUN apt-get update \
    && apt-get install --yes --no-install-recommends postgresql \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/local-container-entrypoint.sh /usr/local/bin/viberacing-local
COPY scripts/test-local-scenarios.mjs /app/apps/web/scripts/test-local-scenarios.mjs
RUN chmod 0755 /usr/local/bin/viberacing-local

ENV DATABASE_URL=postgresql://postgres@127.0.0.1:5432/viberacing
ENV PGDATA=/var/lib/postgresql/data

ENTRYPOINT ["/usr/local/bin/viberacing-local"]
