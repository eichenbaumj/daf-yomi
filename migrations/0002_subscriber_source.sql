-- Where a subscriber came from: the campaign tag of a paid link (`?src=`), or NULL. Names the ad, not the reader.
ALTER TABLE subscribers ADD COLUMN source TEXT;
CREATE INDEX subscribers_source ON subscribers (source);
