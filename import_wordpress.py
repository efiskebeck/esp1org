#!/usr/bin/env python3
"""
WordPress XML → Firestore importer for ESP1.ORG
Usage:
  1. pip install firebase-admin
  2. Last ned serviceAccountKey.json fra Firebase Console →
     Project Settings → Service Accounts → Generate new private key
  3. python3 import_wordpress.py
"""

import xml.etree.ElementTree as ET
import json
import re
from datetime import datetime
from pathlib import Path

# ── Config ────────────────────────────────────────────────
WP_XML   = "esp1-norwegiansportshooter_WordPress_2026-05-30.xml"
KEY_FILE = "serviceAccountKey.json"   # Put this next to the script
DRY_RUN  = False                      # Set True to preview without uploading

# ── Category mapping ───────────────────────────────────────
def resolve_category(title: str, categories: list[str]) -> str:
    title_l = title.lower()
    cats_l  = [c.lower() for c in categories]

    military_keywords = ['militær','military','nato','hns','flo','nlogs','stabsskol','fagartikkel']
    leadership_keywords = ['ledelse','leadership','refleksjon','hitfactor','mentalt']
    personal_keywords = ['bokk','ny bok','personal']

    if any(k in title_l for k in military_keywords): return 'militær'
    if any(k in title_l for k in leadership_keywords): return 'ledelse'
    if any(k in title_l for k in personal_keywords): return 'personlig'

    # Shooting keywords (default for this site)
    shooting_keywords = ['kurs','godkjenning','nm','em','vm','reisebrev','mesterskap',
                         'skyting','match','sesongen','bane','nordic','skepplanda',
                         'moose','fox','latin american','ipsc','norma','geco','sno']
    if any(k in title_l for k in shooting_keywords): return 'skyting'
    return 'skyting'  # Default: skyting


def strip_html(html: str) -> str:
    return re.sub(r'<[^>]+>', '', html)


def parse_date(date_str: str):
    try:
        return datetime.strptime(date_str.strip(), '%Y-%m-%d %H:%M:%S')
    except Exception:
        return datetime.now()


def main():
    print(f"Leser {WP_XML}…")
    tree = ET.parse(WP_XML)
    root = tree.getroot()

    ns = {
        'content': 'http://purl.org/rss/1.0/modules/content/',
        'wp':      'http://wordpress.org/export/1.2/',
        'dc':      'http://purl.org/dc/elements/1.1/',
        'excerpt': 'http://wordpress.org/export/1.2/excerpt/',
    }

    channel = root.find('channel')
    items   = channel.findall('item')

    articles = []
    for item in items:
        post_type = item.find('wp:post_type', ns)
        status    = item.find('wp:status', ns)

        if post_type is None or post_type.text != 'post': continue
        if status    is None or status.text    != 'publish': continue

        title   = item.findtext('title', '').strip()
        body    = item.findtext('content:encoded', '', ns).strip()
        date_s  = item.findtext('wp:post_date', '', ns)
        cats    = [c.text for c in item.findall('category') if c.text]

        date = parse_date(date_s)

        articles.append({
            'title':     title,
            'body':      body,
            'category':  resolve_category(title, cats),
            'tags':      ', '.join(set(cats) - {'Uncategorized','Ukategorisert','Primary','Social Media','Social Links Menu','Social Links','pub/bute','pub/masu','pub/baskerville-2'}),
            'date':      date,
            'published': True,
            'heroImage': None,
            'wpImported': True,
        })

    print(f"\nFunnet {len(articles)} publiserte artikler:")
    for a in articles:
        print(f"  [{a['date'].strftime('%Y-%m-%d')}] [{a['category']:10}] {a['title']}")

    if DRY_RUN:
        print("\n── DRY RUN — ingen data lastet opp ──")
        return

    # ── Upload to Firestore ────────────────────────────────
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        print("\nMangler firebase-admin. Kjør: pip install firebase-admin")
        return

    if not Path(KEY_FILE).exists():
        print(f"\nFinner ikke {KEY_FILE}.")
        print("Last ned fra: Firebase Console → Project Settings → Service Accounts → Generate new private key")
        # Save as JSON for manual upload instead
        out = []
        for a in articles:
            out.append({**a, 'date': a['date'].isoformat()})
        with open('articles_export.json', 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print(f"\nLagret {len(out)} artikler til articles_export.json")
        print("Du kan importere denne manuelt i Firebase Console.")
        return

    cred = credentials.Certificate(KEY_FILE)
    firebase_admin.initialize_app(cred)
    db_ref = firestore.client()

    col = db_ref.collection('articles')
    uploaded = 0
    for a in articles:
        data = {**a, 'date': a['date'], 'createdAt': firestore.SERVER_TIMESTAMP}
        col.add(data)
        uploaded += 1
        print(f"  ✓ {a['title'][:60]}")

    print(f"\n✓ {uploaded} artikler lastet opp til Firestore!")


if __name__ == '__main__':
    main()
