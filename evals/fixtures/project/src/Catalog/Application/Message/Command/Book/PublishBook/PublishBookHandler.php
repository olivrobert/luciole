<?php

declare(strict_types=1);

namespace Catalog\Application\Message\Command\Book\PublishBook;

use Catalog\Domain\Event\BookCopyReturnedToShelf;
use Catalog\Domain\Event\BookPublished;
use Catalog\Domain\Repository\BookRepositoryInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\Envelope;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\DispatchAfterCurrentBusStamp;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class PublishBookHandler
{
    public function __construct(
        private BookRepositoryInterface $bookRepository,
        #[Autowire(service: 'event.bus')]
        private MessageBusInterface $eventBus,
    ) {
    }

    public function __invoke(PublishBook $command): void
    {
        $book = $command->book;
        $book->publish();

        $this->bookRepository->save($book);

        $bookId = $book->getId();
        \assert(null !== $bookId);

        $this->eventBus->dispatch(
            (new Envelope(new BookPublished($bookId)))->with(new DispatchAfterCurrentBusStamp()),
        );

        foreach ($book->bookCopies as $bookCopy) {
            if ($bookCopy->isInStorage()) {
                $this->eventBus->dispatch(new Envelope(new BookCopyReturnedToShelf($bookCopy->shelfMark)));
            }
        }
    }
}
