on run argv
  set playlistId to item 1 of argv
  set songId to item 2 of argv
  set outputFile to POSIX file (item 3 of argv)
  tell application "Music"
    set sourceList to first user playlist whose persistent ID is playlistId
    set sourceTrack to first track of sourceList whose persistent ID is songId
    if (count of artworks of sourceTrack) is 0 then error "Artwork unavailable"
    set imageBytes to raw data of artwork 1 of sourceTrack
  end tell
  set handle to open for access outputFile with write permission
  try
    set eof handle to 0
    write imageBytes to handle
    close access handle
  on error errorMessage
    try
      close access handle
    end try
    error errorMessage
  end try
  return "ok"
end run
