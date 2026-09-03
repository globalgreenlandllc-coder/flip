# Demo photos

Creative Commons photos from Flickr (via Openverse) that exercise the photo
pipeline: paste these into the "photo links" box on the Analyze tab, or POST
them to `/api/v1/analyze` as `photos: [{url}]`.

```
https://live.staticflickr.com/2075/2147920688_cb63db1b68_b.jpg
https://live.staticflickr.com/5187/5865093949_402492b247_b.jpg
https://live.staticflickr.com/8089/8377668989_78291416c7_b.jpg
https://live.staticflickr.com/235/515756267_99f01cf68f_b.jpg
https://live.staticflickr.com/4103/5027516478_4df939c735_b.jpg
```

Exterior of a 1960s ranch, two dated kitchens, a bathroom mid-renovation,
and a living room. They are not one house, so the assessment will say so
in places. Real listings give better results.

```bash
curl -s localhost:3000/api/v1/analyze -H 'content-type: application/json' -d '{
  "photos": [
    {"url": "https://live.staticflickr.com/2075/2147920688_cb63db1b68_b.jpg"},
    {"url": "https://live.staticflickr.com/5187/5865093949_402492b247_b.jpg"}
  ],
  "deal": {"askingPrice": 749000}
}'
```
