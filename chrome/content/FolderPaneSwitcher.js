// -*- js-indent-level: 2 -*-
Components.utils.import("resource:///modules/gloda/log4moz.js");

// Rules:
// 
// onDragEnter: Reset timer
//              Set current row to null
//              Set cached view to null
// onDragExit:  Cancel timer
//              Switch to cached folder view, if any
// onDragDrop:  Same as onDragExit
// onDragOver:  In all folders view?
//              Yes: Do nothing
//              No: Has current row changed?
//                  Yes: Reset timer
//                  No: Do nothing         
// notify:      Cache old folder view
//              Switch to all folders view
// resetTimer:  In all folders view?
//              Yes: Do nothing
//              No: Start timer

var FolderPaneSwitcher = {
  showHideArrowsObserver: {
    observe: function() {
      var prefBranch = Components.classes["@mozilla.org/preferences-service;1"]
        .getService(Components.interfaces.nsIPrefBranch);
      var show = prefBranch.getBoolPref("extensions.FolderPaneSwitcher.arrows");
      document.getElementById("folderPaneHeader").hidden = !show;
    }
  },

  onLoad: function() {
    if (! this.logger) {
      this.logger = Log4Moz.getConfiguredLogger("extensions.FolderPaneSwitcher",
						Log4Moz.Level.Trace,
						Log4Moz.Level.Info,
						Log4Moz.Level.Debug);
    }
    var me = FolderPaneSwitcher;
    var folderTree = document.getElementById("folderTree");
    var treechildren = folderTree.getElementsByTagName("treechildren")[0];
    treechildren.addEventListener("dragenter", me.onDragEnter, false);
    treechildren.addEventListener("dragover", me.onDragOver, false);
    // Dragexit and dragdrop don't actually get sent when the user
    // drops a message into a folder. This is arguably a bug in
    // Thunderbird (see bz#674807). To work around it, I register a
    // folder listener to detect when a move or copy is
    // completed. This is gross, but appears to work well enough.
    treechildren.addEventListener("dragexit", me.onDragExit, false);
    treechildren.addEventListener("dragdrop", me.onDragExit, false);
    var ns =
      Components.classes["@mozilla.org/messenger/msgnotificationservice;1"]
      .getService(Components.interfaces.nsIMsgFolderNotificationService);
    ns.addListener(me.folderListener, ns.msgsMoveCopyCompleted|
		   ns.folderMoveCopyCompleted);
    FolderPaneSwitcher.showHideArrowsObserver.observe();
    var prefBranch = Components.classes["@mozilla.org/preferences-service;1"]
      .getService(Components.interfaces.nsIPrefBranch);
    prefBranch.addObserver("extensions.FolderPaneSwitcher.arrows",
			   FolderPaneSwitcher.showHideArrowsObserver, false);
  },

  folderListener: {
    msgsMoveCopyCompleted: function(aMove, aSrcMsgs, aDestFolder, aDestMsgs) {
      if (aDestFolder == FolderPaneSwitcher.currentFolder) {
	// Still remotely possible that someone else could be copying
	// into the same folder at the same time as us, but this is
	// the best we can do until they fix the event bug.
	FolderPaneSwitcher.onDragExit({type:"msgsMoveCopyCompleted"});
      }
    },
    folderMoveCopyCompleted: function(aMove, aSrcFolder, aDestFolder) {
      if (aDestFolder == FolderPaneSwitcher.currentFolder) {
	// Still remotely possible that someone else could be copying
	// into the same folder at the same time as us, but this is
	// the best we can do until they fix the event bug.
	FolderPaneSwitcher.onDragExit({type:"folderMoveCopyCompleted"});
      }
    }
  },

  onDragEnter: function() {
    FolderPaneSwitcher.logger.debug("onDragEnter");
    FolderPaneSwitcher.resetTimer();
    FolderPaneSwitcher.cachedView = null;
    FolderPaneSwitcher.currentFolder = null;
  },

  onDragExit: function(aEvent) {
    FolderPaneSwitcher.logger.debug("onDragExit("+aEvent.type+")");
    if (FolderPaneSwitcher.timer) {
      FolderPaneSwitcher.timer.cancel();
      FolderPaneSwitcher.timer = null;
    }
    if (FolderPaneSwitcher.cachedView) {
      gFolderTreeView.mode = FolderPaneSwitcher.cachedView;
      FolderPaneSwitcher.cachedView = null;
    }
    FolderPaneSwitcher.currentFolder = null;
  },

  
  dataTransfer: null,
  setDataTransfer: function(real) {
    var dragService = Components
      .classes["@mozilla.org/widget/dragservice;1"]
      .getService(Components.interfaces.nsIDragService);
    var dragSession = dragService.getCurrentSession();
    if (real) {
      if (FolderPaneSwitcher.dataTransfer) {
	dragSession.dataTransfer = FolderPaneSwitcher.dataTransfer;
	FolderPaneSwitcher.dataTransfer = null;
      }
    }
    else {
      FolderPaneSwitcher.dataTransfer = dragSession.dataTransfer;
      dragSession.dataTransfer = null;
    }
  },

  onDragOver: function(aEvent) {
    FolderPaneSwitcher.logger.trace("onDragOver"); // too verbose for debug
    var old = FolderPaneSwitcher.currentFolder;
    FolderPaneSwitcher.currentFolder = 
      gFolderTreeView.getFolderAtCoords(aEvent.clientX, aEvent.clientY);
    if (FolderPaneSwitcher.dataTransfer &&
	old != FolderPaneSwitcher.currentFolder) {
      if (FolderPaneSwitcher.disabledNeedMove) {
	FolderPaneSwitcher.disabledNeedMove = null;
	FolderPaneSwitcher.logger.debug("Setting disabledNeedMove to null");
      }
      else if (FolderPaneSwitcher.dataTransfer) {
	FolderPaneSwitcher.logger.debug("canceling disable");
	FolderPaneSwitcher.setDataTransfer(true);
	if (FolderPaneSwitcher.disabledTimer) {
	  FolderPaneSwitcher.disabledTimer.cancel();
	  FolderPaneSwitcher.disabledTimer = null;
	}
      }
    }
    if (gFolderTreeView.mode == "all") {
      return;
    }
    if (old != FolderPaneSwitcher.currentFolder) {
      FolderPaneSwitcher.resetTimer();
    }
  },

  disabledNeedMove: null,
  disabledTimer: null,
  disabledCallback: {
    notify: function() {
      var folderTree = document.getElementById("folderTree");
      var treechildren = folderTree.getElementsByTagName("treechildren")[0];
      FolderPaneSwitcher.setDataTransfer(true);
      FolderPaneSwitcher.disabledTimer = null;
    }
  },

  timer: null,
  timerCallback: {
    notify: function() {
      FolderPaneSwitcher.logger.debug("timerCallback.notify");
      FolderPaneSwitcher.cachedView = gFolderTreeView.mode;
      // This is, unfortunately, really gross. We want to prevent
      // drops from being allowed for a short period of time after the
      // view switch, to prevent accidental drops into the wrong
      // folder. Unfortunately, I can't find any way to catch and trap
      // the dragdrop event to prevent the drop from being
      // processed. The only way I can find to prevent dropping is to
      // temporarly modify the drag session to null out what's being
      // transferred.
      FolderPaneSwitcher.setDataTransfer(false);
      FolderPaneSwitcher.disabledNeedMove = true;
      gFolderTreeView.mode = "all";

      FolderPaneSwitcher.timer = null;
      var prefBranch = Components.classes["@mozilla.org/preferences-service;1"]
	.getService(Components.interfaces.nsIPrefBranch);
      var delay = prefBranch
	.getIntPref("extensions.FolderPaneSwitcher.dropDelay");
      var t = Components.classes["@mozilla.org/timer;1"]
	.createInstance(Components.interfaces.nsITimer);
      t.initWithCallback(FolderPaneSwitcher.disabledCallback, delay,
			 Components.interfaces.nsITimer.TYPE_ONE_SHOT);
      FolderPaneSwitcher.disabledTimer = t;
    },
  },

  resetTimer: function() {
    if (FolderPaneSwitcher.timer) {
      FolderPaneSwitcher.timer.cancel();
    }
    var prefBranch = Components.classes["@mozilla.org/preferences-service;1"]
      .getService(Components.interfaces.nsIPrefBranch);
    var delay = prefBranch.getIntPref("extensions.FolderPaneSwitcher.delay");
    var t = Components.classes["@mozilla.org/timer;1"]
      .createInstance(Components.interfaces.nsITimer);
    t.initWithCallback(FolderPaneSwitcher.timerCallback, delay,
		       Components.interfaces.nsITimer.TYPE_ONE_SHOT);
    FolderPaneSwitcher.timer = t;
  },
};

window.addEventListener("load", function () { FolderPaneSwitcher.onLoad(); }, false);
