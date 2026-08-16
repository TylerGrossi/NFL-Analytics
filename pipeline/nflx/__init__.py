"""nflx — NFL analytics ingestion pipeline.

Pulls from nflverse (bulk, nightly) and ESPN (live), transforms with polars,
and writes parquet + json into ../data for the Next.js app to query.
"""

__version__ = "0.1.0"
