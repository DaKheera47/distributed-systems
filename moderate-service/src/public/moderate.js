(function () {
  var currentItem = null;
  var polling = false;

  function setStatus(text) {
    $('#status').text(text);
  }

  function populateTypes() {
    return $.getJSON('/moderate-types')
      .done(function (types) {
        var $select = $('#typeSelect');
        $select.empty();
        $select.append($('<option>', { value: '', text: 'Select a type' }));
        types.forEach(function (typeName) {
          $select.append($('<option>', { value: typeName, text: typeName }));
        });
      })
      .fail(function () {
        setStatus('Failed to load types cache');
      });
  }

  function showItem(item) {
    currentItem = item;
    $('#moderationForm').prop('hidden', false);
    $('#setup').val(item.setup);
    $('#punchline').val(item.punchline);
    $('#customType').val('');
    var hasTypeOption = false;
    $('#typeSelect option').each(function () {
      if ($(this).val() === item.type) {
        hasTypeOption = true;
        return false;
      }
    });
    if (!hasTypeOption) {
      $('#typeSelect').append($('<option>', { value: item.type, text: item.type + ' (queued)' }));
    }
    $('#typeSelect').val(item.type);
    setStatus('Joke awaiting moderation (deliveryTag ' + item.deliveryTag + ')');
  }

  function clearItem(message) {
    currentItem = null;
    $('#moderationForm').prop('hidden', true);
    setStatus(message);
  }

  function pollOnce() {
    if (polling || currentItem) {
      return;
    }

    polling = true;
    $.ajax({
      url: '/moderate',
      method: 'GET',
      headers: { Accept: 'application/json' },
      dataType: 'json'
    })
      .done(function (data) {
        if (data.hasItem) {
          populateTypes().always(function () {
            showItem(data);
          });
        } else {
          clearItem('No jokes awaiting moderation');
        }
      })
      .fail(function () {
        setStatus('Failed to poll moderation queue');
      })
      .always(function () {
        polling = false;
      });
  }

  function approvedTypeValue() {
    var custom = ($('#customType').val() || '').toString().trim();
    if (custom) {
      return custom;
    }
    return ($('#typeSelect').val() || '').toString().trim();
  }

  $(function () {
    setInterval(pollOnce, 1000);
    pollOnce();

    $('#moderationForm').on('submit', function (event) {
      event.preventDefault();
      if (!currentItem) {
        setStatus('No moderation item selected');
        return;
      }

      $.ajax({
        url: '/moderated',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
          setup: ($('#setup').val() || '').toString(),
          punchline: ($('#punchline').val() || '').toString(),
          type: approvedTypeValue()
        })
      })
        .done(function () {
          clearItem('Moderated joke published');
          populateTypes();
          pollOnce();
        })
        .fail(function (xhr) {
          setStatus('Approve failed: ' + (xhr.responseJSON && xhr.responseJSON.error ? xhr.responseJSON.error : 'unknown error'));
        });
    });

    $('#rejectBtn').on('click', function () {
      $.ajax({ url: '/reject', method: 'POST' })
        .done(function () {
          clearItem('Joke rejected');
          pollOnce();
        })
        .fail(function (xhr) {
          setStatus('Reject failed: ' + (xhr.responseJSON && xhr.responseJSON.error ? xhr.responseJSON.error : 'unknown error'));
        });
    });
  });
})();
